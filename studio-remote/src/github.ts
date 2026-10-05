// 发布自动同步（规则 5/7）：点发布后把已发布内容提交到 GitHub 仓库，
// push 自动触发公开站构建上线。仓库仍是唯一源码真源——本模块只代替人工拷贝导出包。
import { all, get, run, type Env } from './db';
import { audit } from './auth';
import { collectExport } from './export';

const REPO = 'ZyYang0124/Salticid_Notes';
const BRANCH = 'main';
const API = 'https://api.github.com';

export interface SyncResult {
  ok: boolean;
  detail: string;
}

async function gh(env: Env, path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(API + path, {
    ...init,
    headers: {
      // GitHub API 强制要求 User-Agent；Workers fetch 无默认 UA
      'User-Agent': 'salticid-notes-studio',
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`GitHub ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return null;
  return res.json();
}

function toBase64(bytes: Uint8Array): string {
  // 分块转换：逐字节字符串拼接在 MB 级输入上是 O(n²) 内存灾难（曾触发 1102）
  const chunks: string[] = [];
  const BLOCK = 0x8000;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    const slice = bytes.subarray(i, Math.min(i + BLOCK, bytes.length));
    let bin = '';
    for (let j = 0; j < slice.length; j++) bin += String.fromCharCode(slice[j]);
    chunks.push(bin);
  }
  return btoa(chunks.join(''));
}

/** 把当前已发布内容整体提交到仓库 main：7 个 studio-*.json 全量覆盖 + 新增原图。
 *  所有人（owner/contributor）的发布都会触发；并发发布时后提交者会撞 ref，
 *  自动重读最新 ref 重试（内容为全量快照，重提交不会丢内容）。 */
/** 上传时刻的单张原图备份：blob + 单文件 commit（小而稳，避开同步请求的大负载）。
 *  已存在则跳过（编号永久、原图不可变）。失败返回 false——不影响上传本身。 */
export async function backupOriginalToGitHub(env: Env, publicId: string, bytes: Uint8Array, filename: string): Promise<boolean> {
  try {
    if (!env.GITHUB_TOKEN) return false;
    const already = await get<{ public_id: string }>(env.DB, 'SELECT public_id FROM synced_originals WHERE public_id = ?', publicId);
    if (already) return true;
    const ref = await gh(env, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
    if (!ref?.object?.sha) return false;
    const baseCommit = await gh(env, `/repos/${REPO}/git/commits/${ref.object.sha}`);
    const blob = await gh(env, `/repos/${REPO}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: toBase64(bytes), encoding: 'base64' }),
    });
    if (!blob?.sha) return false;
    const tree = await gh(env, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: [{ path: `media/originals/${filename}`, mode: '100644', type: 'blob', sha: blob.sha }],
      }),
    });
    if (!tree?.sha) return false;
    const commit = await gh(env, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `studio: 原图入库（${publicId}）

上传时刻自动备份。`,
        tree: tree.sha,
        parents: [ref.object.sha],
      }),
    });
    if (!commit?.sha) return false;
    await gh(env, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    await run(env.DB, 'INSERT OR REPLACE INTO synced_originals (public_id) VALUES (?)', publicId);
    await audit(env, 'system', 'github-sync', publicId, 'original-backup-ok');
    return true;
  } catch {
    return false;
  }
}

export async function syncToGitHub(env: Env, label = ''): Promise<SyncResult> {
  try {
    if (!env.GITHUB_TOKEN) return { ok: false, detail: '未配置 GITHUB_TOKEN' };

    // 同步读强制主库：发布后 waitUntil 立即读 D1 可能命中滞后副本，导出会缺刚发布的观察
    const db = typeof (env.DB as any).withSession === 'function' ? (env.DB as any).withSession('first-primary') : env.DB;
    // 原图只读取本次触发观察的新照片（全量读取曾超资源限制被静默杀掉；旧照片已在仓库无需重传）
    const syncedIds = new Set(
      (await all<{ public_id: string }>(db, 'SELECT public_id FROM synced_originals')).map((r) => r.public_id),
    );
    // 只加载「本次触发观察的、且尚未入库」的原图——已入库的重读会挤爆内存（1102 根源）
    const syncOriginals = new Set<string>();
    if (label && /^SFN-/.test(label)) {
      const obsRow = await get<any>(db, 'SELECT id FROM observations WHERE public_id = ?', label);
      if (obsRow) {
        const rows = await all<{ public_id: string }>(db, 'SELECT public_id FROM media WHERE observation_id = ?', obsRow.id);
        rows.forEach(function (r) { if (!syncedIds.has(r.public_id)) syncOriginals.add(r.public_id); });
      }
    }
    let data = await collectExport({ ...env, DB: db }, { loadOriginalsFor: syncOriginals });
    await audit(env, 'system', 'github-sync', label || null, 'probe: collect done, originals=' + Object.keys(data.originals).length + ', memMB=' + Math.round((globalThis as any).performance?.memory?.usedJSHeapSize / 1048576 || 0));
    // 自愈：触发的观察若已发布但不在导出里（副本滞后），重试两次
    if (label && /^SFN-/.test(label)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let present = false;
        try { present = JSON.parse(data.observationsJson).some(function (o: any) { return o.public_id === label; }); } catch (e) {}
        if (present) break;
        await new Promise(function (r) { setTimeout(r, 1500); });
        data = await collectExport({ ...env, DB: db }, { loadOriginalsFor: syncOriginals });
      }
    }
    const jsonFiles: { path: string; content: string }[] = [
      { path: 'src/data/studio-places.json', content: data.placesJson },
      { path: 'src/data/studio-taxa.json', content: data.taxaJson },
      { path: 'src/data/studio-profiles.json', content: data.profilesJson },
      { path: 'src/data/studio-observations.json', content: data.observationsJson },
      { path: 'src/data/studio-locations.json', content: data.locationsJson },
      { path: 'src/data/studio-media.json', content: data.mediaJson },
      { path: 'src/data/studio-identifications.json', content: data.identificationsJson },
      { path: 'src/data/studio-posts.json', content: data.postsJson },
    ];

    const files: { path: string; content: string; encoding: 'utf-8' | 'base64' }[] = jsonFiles.map((f) => ({
      ...f,
      encoding: 'utf-8' as const,
    }));
    // 原图上传：只传本次触发观察的新原图（synced_originals 防重）
    const synced = new Set(
      (await all<{ public_id: string }>(db, 'SELECT public_id FROM synced_originals')).map((r) => r.public_id),
    );
    const newOriginals: string[] = [];
    for (const [key, bytes] of Object.entries(data.originals)) {
      const filename = key.slice('originals/'.length);
      const pid = filename.replace(/\.(jpg|jpeg|png)$/i, '');
      if (!pid || synced.has(pid)) continue;
      files.push({ path: `media/originals/${filename}`, content: toBase64(bytes), encoding: 'base64' });
      newOriginals.push(pid);
    }

    // 并发发布：ref 更新撞车（422）时重读最新 ref 重试，最多 3 次
    let lastError: unknown = null;
    const bad = (step: string, got: unknown): Error =>
      new Error(`[step ${step}] 响应异常：${JSON.stringify(got)?.slice(0, 300)}`);
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const ref = await gh(env, `/repos/${REPO}/git/ref/heads/${BRANCH}`);
        if (!ref?.object?.sha) throw bad('ref', ref);
        // 注意用 git data API 的 commit 端点（小响应，必有 tree）；/commits/{sha} 的表示形式不稳定
        const baseCommit = await gh(env, `/repos/${REPO}/git/commits/${ref.object.sha}`);
        if (!baseCommit?.tree?.sha) throw bad('base-commit', baseCommit);
        const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
        for (const f of files) {
          const blob = await gh(env, `/repos/${REPO}/git/blobs`, {
            method: 'POST',
            body: JSON.stringify({ content: f.content, encoding: f.encoding }),
          });
          if (!blob?.sha) throw bad(`blob ${f.path}`, blob);
          tree.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
        }
        const newTree = await gh(env, `/repos/${REPO}/git/trees`, {
          method: 'POST',
          body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
        });
        if (!newTree?.sha) throw bad('tree', newTree);
        const message = `studio: 自动同步发布内容${label ? `（${label}）` : ''}\n\n由 Field Studio 发布动作自动提交；push 触发公开站构建（规则 5/7）。`;
        await audit(env, 'system', 'github-sync', label || null, 'probe: blobs+tree done, mem=' + Math.round((globalThis as any).performance?.memory?.usedJSHeapSize / 1048576 || 0) + 'MB');
        const newCommit = await gh(env, `/repos/${REPO}/git/commits`, {
          method: 'POST',
          body: JSON.stringify({ message, tree: newTree.sha, parents: [ref.object.sha] }),
        });
        if (!newCommit?.sha) throw bad('commit', newCommit);
        await gh(env, `/repos/${REPO}/git/refs/heads/${BRANCH}`, {
          method: 'PATCH',
          body: JSON.stringify({ sha: newCommit.sha, force: false }),
        });

        for (const pid of newOriginals) {
          await run(env.DB, 'INSERT OR REPLACE INTO synced_originals (public_id) VALUES (?)', pid);
        }
        // 审计带上导出的观察清单（排障用：同步缺内容时立即可见）
        let exportedIds = '';
        try { exportedIds = JSON.parse(data.observationsJson).map(function (o: any) { return o.public_id; }).join(','); } catch (e) {}
        return { ok: true, detail: `已提交 ${files.length} 个文件 · 观察[${exportedIds}]` };
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message ?? err);
        if (!msg.includes('422')) throw err;
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
    return {
      ok: false,
      detail: '并发同步冲突，重试 3 次未成功：' + String((lastError as any)?.message ?? lastError),
    };
  } catch (err: any) {
    return { ok: false, detail: String(err?.message ?? err) };
  }
}
