// 发布自动同步（规则 5/7）：点发布后把已发布内容提交到 GitHub 仓库，
// push 自动触发公开站构建上线。仓库仍是唯一源码真源——本模块只代替人工拷贝导出包。
import { all, run, type Env } from './db';
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
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** 把当前已发布内容整体提交到仓库 main：7 个 studio-*.json 全量覆盖 + 新增原图。
 *  所有人（owner/contributor）的发布都会触发；并发发布时后提交者会撞 ref，
 *  自动重读最新 ref 重试（内容为全量快照，重提交不会丢内容）。 */
export async function syncToGitHub(env: Env, label = ''): Promise<SyncResult> {
  try {
    if (!env.GITHUB_TOKEN) return { ok: false, detail: '未配置 GITHUB_TOKEN' };

    // 同步读强制主库：发布后 waitUntil 立即读 D1 可能命中滞后副本，导出会缺刚发布的观察
    const db = typeof (env.DB as any).withSession === 'function' ? (env.DB as any).withSession('first-primary') : env.DB;
    // 数据同步不携带原图（大文件 base64 上传曾超 Worker 资源限制被静默杀掉）；
    // 原图永久保存在 R2，仓库原图备份走本地脚本
    let data = await collectExport({ ...env, DB: db }, { loadOriginals: false });
    // 自愈：触发的观察若已发布但不在导出里（副本滞后），重试两次
    if (label && /^SFN-/.test(label)) {
      for (let attempt = 0; attempt < 2; attempt++) {
        let present = false;
        try { present = JSON.parse(data.observationsJson).some(function (o: any) { return o.public_id === label; }); } catch (e) {}
        if (present) break;
        await new Promise(function (r) { setTimeout(r, 1500); });
        data = await collectExport({ ...env, DB: db }, { loadOriginals: false });
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

    // 原图只上传仓库里还没有的编号（规则 19/20：编号永久、原图不可变，因此已提交过的不需重传）
    const synced = new Set(
      (await all<{ public_id: string }>(env.DB, 'SELECT public_id FROM synced_originals')).map((r) => r.public_id),
    );
    const newOriginals: string[] = [];
    const files: { path: string; content: string; encoding: 'utf-8' | 'base64' }[] = jsonFiles.map((f) => ({
      ...f,
      encoding: 'utf-8' as const,
    }));
    // 原图不随数据同步上传：R2 为永久存储，仓库备份由本地脚本承担

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
