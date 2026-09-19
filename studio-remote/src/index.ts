// Field Studio 远程版：Cloudflare Workers + D1 + R2。
// 业务规则与本地 studio/src/server.ts 一一对应；差异仅在运行时适配：
//   - Express → Hono；better-sqlite3 → D1（全部异步）；sharp → 浏览器端派生图（editorjs.ts）
//   - 原图存 R2（永不覆盖，规则 20）；导出为 zip 包（GitHub 仍是唯一源码真源，规则 5）
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env } from './db';
import { all, get, nextCounter, pad6, run } from './db';
import {
  audit,
  createSession,
  currentUser,
  deliverOtp,
  destroySession,
  findOrCreateUserByEmail,
  isInvited,
  issueOtp,
  sameOrigin,
  SESSION_COOKIE,
  secureCookies,
  verifyOtp,
  type StudioUser,
} from './auth';
import { articleUrl, mediaForObservation, mediaByPublicId, saveUpload, thumbUrl, type MediaRow } from './media';
import { parseExif } from './exif';
import { renderArticle } from './article';
import { buildResolvers } from './embeds';
import { buildExportZip } from './export';
import { syncToGitHub } from './github';
import { esc, loginPage, mediaPage, noteEditorHtml, obsEditorHtml, page, STYLES, homePage, draftsPage, dataPage, relTime, taxaManagePage, importPage, type FeedItem } from './pages';
import { invitePage } from './invites';
import { OBS_EDITOR_SCRIPT, NOTE_EDITOR_SCRIPT, LOGIN_SCRIPT, PROFILE_SCRIPT, IMPORT_SCRIPT } from './editorjs';
import { allTaxonOptions, createWorkingTaxon, findTaxonOptionBySlug, mergeWorkingTaxon, renameWorkingTaxon } from './taxa';
import { suggestGenera, suggestSpecies, validateFormalName } from './wsc';

const app = new Hono<{ Bindings: Env; Variables: { user: StudioUser } }>();

async function auth(c: any): Promise<StudioUser | null> {
  return currentUser(c.env, getCookie(c, SESSION_COOKIE));
}

// 受保护路径的认证中间件：未登录 → 302 登录页（中间件返回 Response 可短路）
const PUBLIC_PATHS = new Set(['/studio/login']);
function isPublicPath(path: string): boolean {
  return PUBLIC_PATHS.has(path) || path.startsWith('/studio/login/') || path.startsWith('/studio.css') || path.startsWith('/studio-editor.js') || path.startsWith('/studio-note-editor.js') || path.startsWith('/studio-import.js');
}
function deny(c: any): Response {
  // JSON API 返回 401，页面路径 302 到登录页
  return c.req.path.startsWith('/studio/api/')
    ? c.json({ error: '未登录' }, 401)
    : c.redirect('/studio/login');
}
app.use('/studio', async (c, next) => {
  if (isPublicPath(c.req.path)) return next();
  const user = await auth(c);
  if (!user) return deny(c);
  c.set('user', user);
  return next();
});
app.use('/studio/*', async (c, next) => {
  if (isPublicPath(c.req.path)) return next();
  const user = await auth(c);
  if (!user) return deny(c);
  c.set('user', user);
  return next();
});

function user(c: any): StudioUser {
  return c.get('user') as StudioUser;
}

function requireOwner(c: any): StudioUser | null {
  const u = user(c);
  if (u.role !== 'owner') {
    c.status(403);
    c.text('只有站长可以执行该操作。');
    return null;
  }
  return u;
}

function setSessionCookie(c: any, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: secureCookies(c.env),
    path: '/',
    maxAge: 14 * 24 * 3600,
  });
}

// ---------- 静态资源 ----------

app.get('/', (c) => c.redirect('/studio'));
app.get('/studio.css', (c) => c.body(STYLES, 200, { 'Content-Type': 'text/css; charset=utf-8' }));
app.get('/studio-editor.js', (c) => c.body(OBS_EDITOR_SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
app.get('/studio-note-editor.js', (c) => c.body(NOTE_EDITOR_SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
app.get('/studio-import.js', (c) => c.body(IMPORT_SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
app.get('/studio-login.js', (c) => c.body(LOGIN_SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));

// ---------- R2 派生图（Studio 内部展示用；公开站仍由构建管线产出自己的派生图） ----------

app.get('/media/derivatives/*', async (c) => {
  const key = c.req.path.replace('/media/derivatives/', '');
  if (!/^[\w.-]+$/.test(key)) return c.text('Bad Request', 400);
  const obj = await c.env.MEDIA.get(`derivatives/${key}`);
  if (!obj) return c.text('Not Found', 404);
  const type = key.endsWith('.webp') ? 'image/webp' : key.endsWith('.avif') ? 'image/avif' : 'image/jpeg';
  return c.body(obj.body, 200, { 'Content-Type': type, 'Cache-Control': 'private, max-age=3600' });
});

// ---------- 登录（受邀邮箱 OTP） ----------

app.get('/studio/login', async (c) => {
  if (await auth(c)) return c.redirect('/studio');
  const q = c.req.query();
  void q;
  return c.html(loginPage({ devNotice: !c.env.RESEND_API_KEY }));
});

app.post('/studio/login/otp', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const form = await c.req.parseBody();
  const email = String((form as any).email ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return c.redirect('/studio/login');
  if (!(await isInvited(c.env, email))) {
    await audit(c.env, email, 'session', null, 'otp-denied-not-invited');
    if (c.req.header('X-Studio-Api') === '1') return c.json({ ok: false, error: 'invite', message: '该邮箱不在受邀名单中' });
    return c.redirect('/studio/login?error=invite');
  }
  let code: string;
  try {
    code = await issueOtp(c.env, email);
  } catch (err: any) {
    if (c.req.header('X-Studio-Api') === '1') return c.json({ ok: false, error: 'rate', message: err.message });
    return c.html(page('登录', `<div class="msg error">${esc(err.message)}</div><p><a href="/studio/login">返回</a></p>`));
  }
  const via = await deliverOtp(c.env, email, code);
  if (c.req.header('X-Studio-Api') === '1') return c.json({ ok: true, via });
  return c.redirect(`/studio/login?email=${encodeURIComponent(email)}`);
});

app.post('/studio/login/verify', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const form = await c.req.parseBody();
  const email = String((form as any).email ?? '');
  const code = String((form as any).code ?? '');
  if (!(await verifyOtp(c.env, email, code))) {
    if (c.req.header('X-Studio-Api') === '1') return c.json({ ok: false, error: 'otp', message: '验证码无效或已过期' });
    return c.redirect('/studio/login?error=otp');
  }
  const user = await findOrCreateUserByEmail(c.env, email);
  await run(c.env.DB, 'UPDATE invitations SET claimed_by = ? WHERE lower(email) = lower(?) AND claimed_by IS NULL', user.id, email);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await createSession(c.env, token, user.id);
  setSessionCookie(c, token);
  await audit(c.env, user.display_name, 'session', user.id, 'login-otp');
  if (c.req.header('X-Studio-Api') === '1') return c.json({ ok: true });
  return c.redirect('/studio');
});

app.get('/studio/logout', async (c) => {
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const token = getCookie(c, SESSION_COOKIE) ?? '';
  await destroySession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/studio/login');
});

// ---------- 工作台（问候式） ----------

app.get('/studio', async (c) => {
  const u = user(c);
  const items = await recentItems(c.env, u.id, 8);
  return c.html(homePage(u, items));
});

async function recentItems(env: Env, userId: number, limit: number, includeAll = false): Promise<FeedItem[]> {
  const scope = includeAll ? '' : 'AND o.created_by = ?';
  const params: unknown[] = includeAll ? [] : [userId];
  const obsRows = await all<any>(
    env.DB,
    `SELECT o.public_id, o.status, o.updated_at, o.published_at, o.created_by,
            u.display_name AS author, i.display_identification,
            o.admin1, o.locality,
            (SELECT public_id FROM media m WHERE m.observation_id = o.id AND m.is_cover = 1 LIMIT 1) AS cover_id
     FROM observations o
     LEFT JOIN identifications i ON i.observation_id = o.id AND i.is_current = 1
     LEFT JOIN users u ON u.id = o.created_by
     WHERE o.status IN ('draft','published','private','archived') ${scope}
     ORDER BY COALESCE(o.published_at, o.updated_at) DESC LIMIT 60`,
    ...params,
  );
  const noteRows = await all<any>(
    env.DB,
    `SELECT slug, title, status, updated_at, published_at FROM posts
     WHERE author_id = ? AND status IN ('draft','published')
     ORDER BY COALESCE(published_at, updated_at) DESC LIMIT 40`,
    userId,
  );
  const toTs = (v: unknown): number => {
    const raw = String(v ?? '');
    const t = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z').getTime();
    return Number.isNaN(t) ? 0 : t;
  };
  const items: FeedItem[] = [];
  for (const o of obsRows) {
    const published = o.status === 'published';
    const ts = toTs(published ? o.published_at || o.updated_at : o.updated_at);
    items.push({
      kind: 'obs', publicId: o.public_id, href: `/studio/observations/${o.public_id}/edit`,
      title: o.display_identification || o.public_id, status: o.status, author: o.author,
      timeText: relTime(new Date(ts).toISOString()), ts,
      thumb: o.cover_id ? `/media/derivatives/${o.cover_id}-480.jpg` : null,
      place: [o.admin1, o.locality].filter(Boolean).join(' · ') || null,
    });
  }
  for (const n of noteRows) {
    const published = n.status === 'published';
    const ts = toTs(published ? n.published_at || n.updated_at : n.updated_at);
    items.push({ kind: 'note', publicId: n.slug, href: `/studio/notes/${n.slug}/edit`, title: n.title || '未命名札记', status: published ? 'published' : 'draft', timeText: relTime(new Date(ts).toISOString()), ts });
  }
  items.sort((a, b) => b.ts - a.ts);
  return items.slice(0, limit);
}

app.get('/studio/drafts', async (c) => {
  const u = user(c);
  const items = await recentItems(c.env, u.id, 100, u.role === 'owner');
  return c.html(draftsPage(u, items, u.role === 'owner'));
});

// ---------- 观察：JSON API ----------

app.post('/studio/api/observations', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const year = new Date().getFullYear();
  const seq = await nextCounter(c.env.DB, `sfn-observation-${year}`);
  const publicId = `SFN-${year}-${pad6(seq)}`;
  await run(
    c.env.DB,
    `INSERT INTO observations (public_id, created_by, observer_name, observed_at, observed_at_precision, field_note, status, visibility)
     VALUES (?,?,?,?,?,?,?,?)`,
    publicId,
    u.id,
    u.display_name,
    new Date().toISOString().slice(0, 10),
    'day',
    '',
    'draft',
    'private',
  );
  await audit(c.env, u.display_name, 'observation', publicId, 'create-draft');
  return c.json({ public_id: publicId, edit_url: `/studio/observations/${publicId}/edit` });
});

const OBS_FIELDS = new Set([
  'observed_at', 'latitude', 'longitude', 'country_name', 'admin1', 'admin2',
  'locality', 'site_name', 'elevation_m', 'sex', 'life_stage', 'count', 'habitat',
  'microhabitat', 'behavior', 'plant', 'weather', 'field_note', 'trip_slug',
  'species_taxon_slug', 'species_evidence',
]);

async function upsertIdentification(env: Env, obsRowId: number, obsPublicId: string, slug: string, displayOverride: string | null, evidence: string, author: string): Promise<void> {
  // 类群来源：静态正式类群或工作编号（§21-§24，cf./aff./sp. 均为合法鉴定目标）
  const taxon = await findTaxonOptionBySlug(env, slug);
  if (!taxon) throw new Error('未知的类群');
  const display =
    (displayOverride && displayOverride.trim()) ||
    (['species', 'subspecies'].includes(taxon.rank) ? taxon.name : `${taxon.name} sp.`);
  const prev = await get<{ display_identification: string; taxon_slug: string }>(
    env.DB,
    'SELECT display_identification, taxon_slug FROM identifications WHERE observation_id = ? AND is_current = 1',
    obsRowId,
  );
  const changed = !prev || prev.taxon_slug !== slug || prev.display_identification !== display;
  await run(env.DB, 'UPDATE identifications SET is_current = 0 WHERE observation_id = ?', obsRowId);
  await run(
    env.DB,
    `INSERT INTO identifications (observation_id, taxon_slug, display_identification, identified_by, identified_at, evidence, is_current)
     VALUES (?,?,?,?,?,?,1)`,
    obsRowId,
    slug,
    display,
    author,
    new Date().toISOString().slice(0, 10),
    evidence,
  );
  if (changed) {
    const cnt = await get<{ c: number }>(
      env.DB,
      "SELECT COUNT(*) AS c FROM revisions WHERE entity_type = 'identification' AND entity_id = ?",
      obsPublicId,
    );
    await run(
      env.DB,
      "INSERT INTO revisions (entity_type, entity_id, version, action, data_snapshot, author) VALUES ('identification', ?, ?, '修改物种鉴定', ?, ?)",
      obsPublicId,
      (cnt?.c ?? 0) + 1,
      JSON.stringify({ from: prev?.display_identification ?? null, to: display }),
      author,
    );
  }
}

app.patch('/studio/api/observations/:public_id', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT * FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.text('未找到该观察。', 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能编辑自己的记录', 403);

  const b = (await c.req.json()) as Record<string, unknown>;
  // 客户端字段名 → 数据库列名（坐标在库中为 exact_*，公开政策为全量精确，无模糊列）
  const COLUMN_OF: Record<string, string> = { latitude: 'exact_latitude', longitude: 'exact_longitude' };
  // 空串语义按列区分：可空列存 NULL；sex/life_stage 回退默认值；
  // field_note / observed_at 为 NOT NULL（field_note DEFAULT ''），空串原样写入，否则触发约束 500
  const NULLABLE = new Set([
    'latitude', 'longitude', 'country_name', 'admin1', 'admin2', 'locality', 'site_name',
    'elevation_m', 'count', 'habitat', 'microhabitat', 'behavior', 'plant', 'weather', 'trip_slug',
  ]);
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [k, v] of Object.entries(b)) {
    if (!OBS_FIELDS.has(k)) continue;
    if (k === 'species_taxon_slug' || k === 'species_evidence') continue; // 鉴定走 upsertIdentification，不是列
    sets.push(`${COLUMN_OF[k] ?? k} = ?`);
    if (v === '') vals.push(NULLABLE.has(k) ? null : (k === 'sex' || k === 'life_stage' ? 'unknown' : ''));
    else vals.push(v);
  }
  if (sets.length) {
    sets.push("updated_at = datetime('now')");
    await run(c.env.DB, `UPDATE observations SET ${sets.join(', ')} WHERE id = ?`, ...vals, obs.id);
  }
  // 地点引用：place_id 必须指向真实地点（§14/§15）
  if (b.place_id !== undefined) {
    const pid = b.place_id === null ? null : Number(b.place_id);
    if (pid !== null) {
      const exists = await get<any>(c.env.DB, 'SELECT id FROM places WHERE id = ? AND merged_into_id IS NULL', pid);
      if (!exists) return c.json({ error: '地点不存在或已合并' }, 400);
    }
    await run(c.env.DB, 'UPDATE observations SET place_id = ? WHERE id = ?', pid, obs.id);
  }
  if (typeof b.species_taxon_slug === 'string' && b.species_taxon_slug) {
    await upsertIdentification(
      c.env,
      obs.id,
      obs.public_id,
      b.species_taxon_slug,
      null,
      typeof b.species_evidence === 'string' ? b.species_evidence : 'field',
      u.display_name,
    );
  }
  // 地点补挂（§72）：仍无地点但填写了地点信息 → 自动建点并挂接（同名同地直接复用）
  const rowNow = await get<any>(
    c.env.DB,
    'SELECT place_id, country_name, admin1, admin2, locality, site_name, exact_latitude, exact_longitude, elevation_m FROM observations WHERE id = ?',
    obs.id,
  );
  if (rowNow && rowNow.place_id == null) {
    const hasInfo = [rowNow.admin1, rowNow.admin2, rowNow.locality, rowNow.site_name].some((v) => v != null && v !== '');
    if (hasInfo) {
      const place = await findOrCreatePlace(
        c.env,
        {
          country: rowNow.country_name, admin1: rowNow.admin1, admin2: rowNow.admin2, locality: rowNow.locality,
          site_name: rowNow.site_name, latitude: rowNow.exact_latitude, longitude: rowNow.exact_longitude,
          elevation_m: rowNow.elevation_m,
        },
        u.display_name,
      );
      await run(c.env.DB, 'UPDATE observations SET place_id = ? WHERE id = ?', place.id, obs.id);
      await audit(c.env, u.display_name, 'place', String(place.id), 'place.auto-linked', { observation: obs.public_id });
    }
  }
  // 已发布记录的显式保存（保存修改）：立即更新公开页面（§6/§29）；autosave 静默，不刷审计与同步
  if (obs.status === 'published' && b.explicit === true && sets.length) {
    await audit(c.env, u.display_name, 'observation', obs.public_id, 'observation.updated', { fields: Object.keys(b).filter((k) => OBS_FIELDS.has(k)) });
    c.executionCtx.waitUntil(
      syncToGitHub(c.env, obs.public_id).then((r) =>
        audit(c.env, u.display_name, 'github-sync', obs.public_id, r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
      ),
    );
    return c.json({ ok: true, saved_at: new Date().toISOString().slice(11, 19), sync: 'queued' });
  }
  return c.json({ ok: true, saved_at: new Date().toISOString().slice(11, 19) });
});

// ---------- 照片上传（浏览器端已生成派生图；按 original/width/height/variant 分组） ----------

interface UploadGroup {
  original: File | null;
  width: number;
  height: number;
  variants: { name: string; blob: Blob }[];
}

function groupUploads(fd: FormData): UploadGroup[] {
  const groups: UploadGroup[] = [];
  for (const [key, val] of fd.entries()) {
    if (key === 'original') {
      groups.push({ original: val as File, width: 0, height: 0, variants: [] });
    } else if (key === 'width') {
      groups[groups.length - 1].width = Number(val);
    } else if (key === 'height') {
      groups[groups.length - 1].height = Number(val);
    } else if (key === 'variant') {
      const f = val as File;
      groups[groups.length - 1].variants.push({ name: f.name, blob: f });
    }
  }
  return groups.filter((g) => g.original);
}

app.post('/studio/observations/:public_id/photos', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT id, public_id, created_by, status FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.text('未找到该观察。', 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能管理自己的照片。', 403);
  const fd = await c.req.formData();
  const groups = groupUploads(fd);
  if (!groups.length) return c.text('没有照片。', 400);
  const base = await get<{ m: number }>(c.env.DB, 'SELECT COALESCE(MAX(sort_order), 0) AS m FROM media WHERE observation_id = ?', obs.id);
  let order = base?.m ?? 0;
  const added: string[] = [];
  for (const g of groups) {
    order += 1;
    let saved;
    try {
      saved = await saveUpload(
        c.env,
        u.display_name,
        { original: g.original!, width: g.width, height: g.height, variants: g.variants },
        { observationId: obs.id, noteSlug: null, publicVisibility: obs.status === 'published' },
      );
    } catch (err: any) {
      return c.text(err?.message ?? '照片保存失败', 400);
    }
    await run(
      c.env.DB,
      'UPDATE media SET sort_order = ?, is_cover = ? WHERE public_id = ?',
      order,
      order === 1 ? 1 : 0,
      saved.publicId,
    );
    added.push(saved.publicId);
  }
  await audit(c.env, u.display_name, 'media', obs.public_id, 'upload', { added });
  return c.json({ ok: true, added });
});

app.post('/studio/api/media/:public_id/caption', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const m = await mediaByPublicId(c.env, c.req.param('public_id'));
  if (!m) return c.json({ error: '未找到' }, 404);
  const obs = m.observation_id ? await get<{ created_by: number }>(c.env.DB, 'SELECT created_by FROM observations WHERE id = ?', m.observation_id) : undefined;
  if (u.role !== 'owner' && (!obs || obs.created_by !== u.id)) return c.text('无权操作。', 403);
  const body = (await c.req.json()) as { caption?: string };
  await run(c.env.DB, 'UPDATE media SET caption = ? WHERE id = ?', String(body.caption ?? '').slice(0, 300), m.id);
  return c.json({ ok: true });
});

// 札记插图上传（不挂观察，note 引用）
app.post('/studio/api/media/upload', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const fd = await c.req.formData();
  const groups = groupUploads(fd);
  if (!groups.length) return c.json({ error: '没有文件' }, 400);
  let saved;
  try {
    saved = await saveUpload(c.env, u.display_name, {
      original: groups[0].original!,
      width: groups[0].width,
      height: groups[0].height,
      variants: groups[0].variants,
    }, { observationId: null, noteSlug: null, publicVisibility: false });
  } catch (err: any) {
    return c.json({ error: err?.message ?? '照片保存失败' }, 400);
  }
  await audit(c.env, u.display_name, 'media', saved.publicId, 'upload-note-image');
  return c.json({ ok: true, public_id: saved.publicId, url: thumbUrl({ ...(await mediaByPublicId(c.env, saved.publicId))! } as MediaRow) });
});

app.delete('/studio/api/media/:public_id', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const m = await mediaByPublicId(c.env, c.req.param('public_id'));
  if (!m) return c.json({ error: '未找到' }, 404);
  const obs = m.observation_id ? await get<{ created_by: number }>(c.env.DB, 'SELECT created_by FROM observations WHERE id = ?', m.observation_id) : undefined;
  if (u.role !== 'owner' && (!obs || obs.created_by !== u.id)) return c.text('无权操作。', 403);
  await run(c.env.DB, 'DELETE FROM media WHERE id = ?', m.id);
  // R2 派生图保留（编号已用掉不再复用，规则 19）；原图永不删除（规则 20）
  if (m.photo_hash) await run(c.env.DB, 'UPDATE photo_hashes SET deleted = 1 WHERE hash = ?', m.photo_hash);
  await audit(c.env, u.display_name, 'media', m.public_id, 'delete');
  return c.json({ ok: true });
});

app.post('/studio/api/observations/:public_id/photos/order', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT id, created_by, public_id FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('无权操作。', 403);
  const body = (await c.req.json()) as { order?: string[] };
  const order = body.order ?? [];
  for (let i = 0; i < order.length; i++) {
    await run(c.env.DB, 'UPDATE media SET sort_order = ?, is_cover = ? WHERE public_id = ? AND observation_id = ?', i + 1, i === 0 ? 1 : 0, order[i], obs.id);
  }
  await audit(c.env, u.display_name, 'media', obs.public_id, 'reorder');
  return c.json({ ok: true });
});

// 发布（§42 校验：日期 + 坐标 + 至少一张照片；物种允许 Unknown → Salticidae sp.）
/** 地点查找或创建：同名同省同市即视为同一地点（§17 去重）；返回既有或新建的地点行。 */
async function findOrCreatePlace(
  env: Env,
  p: { country?: string | null; admin1?: string | null; admin2?: string | null; locality?: string | null; site_name?: string | null; latitude?: number | null; longitude?: number | null; elevation_m?: number | null },
  actor: string,
): Promise<{ id: number; name: string }> {
  const name = (p.locality || p.admin2 || p.admin1 || '未命名地点').slice(0, 120);
  const existing = await get<any>(
    env.DB,
    "SELECT id, name FROM places WHERE merged_into_id IS NULL AND name = ? AND COALESCE(admin1, '') = ? AND COALESCE(admin2, '') = ? AND COALESCE(country, '') = ?",
    name, p.admin1 ?? '', p.admin2 ?? '', p.country ?? '',
  );
  if (existing) return existing;
  await run(
    env.DB,
    `INSERT INTO places (name, country, admin1, admin2, locality, site_name, latitude, longitude, elevation_m, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    name, p.country ?? '', p.admin1 ?? '', p.admin2 ?? '', p.locality ?? '', p.site_name ?? '',
    p.latitude ?? null, p.longitude ?? null, p.elevation_m ?? null, actor,
  );
  const row = await get<any>(env.DB, 'SELECT id, name FROM places WHERE id = last_insert_rowid()');
  await audit(env, actor, 'place', String(row!.id), 'place.created', { name: row!.name });
  return row!;
}

// ---------- 状态机（发布=立即公开）：status 是生命周期唯一真源，visibility 由状态派生 ----------

type ObsStatus = 'draft' | 'published' | 'private' | 'archived';
const STATUS_ZH: Record<string, string> = { draft: '草稿', published: '已发布', private: '私密', archived: '已归档' };
const VISIBILITY_BY_STATUS: Record<ObsStatus, 'public' | 'private'> = {
  draft: 'private',
  published: 'public',
  private: 'private',
  archived: 'private',
};
const STATUS_AUDIT: Record<ObsStatus, string> = {
  draft: 'observation.restored',
  published: 'observation.published',
  private: 'observation.made_private',
  archived: 'observation.archived',
};

/** 唯一的状态转换入口：写状态、派生 visibility、级联媒体可见性、
 *  保留首次 published_at（保存修改不改变发布时间，§6）、记录带 prev/new 的审计。 */
async function transitionObservation(
  env: Env,
  obs: { id: number; public_id: string; status: string },
  to: ObsStatus,
  actor: string,
): Promise<void> {
  const from = obs.status;
  const visibility = VISIBILITY_BY_STATUS[to];
  await run(
    env.DB,
    `UPDATE observations SET status = ?, visibility = ?, updated_at = datetime('now'),
       published_at = CASE WHEN ? = 'published' AND COALESCE(published_at, '') = '' THEN datetime('now') ELSE published_at END
     WHERE id = ?`,
    to,
    visibility,
    to,
    obs.id,
  );
  await run(env.DB, 'UPDATE media SET visibility = ? WHERE observation_id = ?', visibility, obs.id);
  await audit(env, actor, 'observation', obs.public_id, STATUS_AUDIT[to], { from, to });
}

/** 进入或离开 published 都会改变公开站内容 → 自动同步仓库（§24：内容流与代码部署分离） */
function queueSyncIfAffectsSite(c: any, env: Env, publicId: string, from: string, to: string): void {
  if (from !== 'published' && to !== 'published') return;
  c.executionCtx.waitUntil(
    syncToGitHub(env, publicId).then((r) =>
      audit(env, 'system', 'github-sync', publicId, r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
    ),
  );
}

app.post('/studio/api/observations/:public_id/publish', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT * FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能发布自己的记录。', 403);
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}/.test(String(obs.observed_at ?? ''))) problems.push('缺少观察日期');
  if (obs.exact_latitude == null || obs.exact_longitude == null) problems.push('缺少坐标（纬度/经度）');
  const photoCount = await get<{ c: number }>(c.env.DB, 'SELECT COUNT(*) AS c FROM media WHERE observation_id = ?', obs.id);
  if ((photoCount?.c ?? 0) === 0) problems.push('至少需要一张照片');
  if (problems.length) return c.json({ error: problems.join('；') }, 400);

  // WSC 正式学名核验：属名 WSC 不存在 → 拦截发布；种名不存在 → 警告并建议 sp（不阻塞）
  const warnings: string[] = [];
  const currentIdn = await get<{ display_identification: string }>(
    c.env.DB,
    'SELECT display_identification FROM identifications WHERE observation_id = ? AND is_current = 1',
    obs.id,
  );
  if (currentIdn) {
    const v = await validateFormalName(c.env, currentIdn.display_identification);
    if (v.checked && !v.genusKnown) {
      return c.json({ error: `WSC 无此属名——请核对「${currentIdn.display_identification}」的属名拼写；如为存疑或未发表类群，请改用工作编号。` }, 400);
    }
    if (v.checked && v.speciesKnown === false) {
      const genus = currentIdn.display_identification.trim().split(/\s+/)[0];
      warnings.push(`WSC 无组合「${currentIdn.display_identification}」——若为存疑鉴定，建议记为「${genus} sp.」或使用工作编号，并待分类学研究明确。`);
      await audit(c.env, u.display_name, 'taxon', obs.public_id, 'wsc.species-unknown', { name: currentIdn.display_identification });
    }
  }

  await run(
    c.env.DB,
    "UPDATE observations SET status = 'published', visibility = 'public', updated_at = datetime('now'), published_at = COALESCE(NULLIF(published_at, ''), datetime('now')) WHERE id = ?",
    obs.id,
  );
  await run(c.env.DB, "UPDATE media SET visibility = 'public' WHERE observation_id = ?", obs.id);
  const idn = await get(c.env.DB, 'SELECT id FROM identifications WHERE observation_id = ? AND is_current = 1', obs.id);
  if (!idn) {
    await run(
      c.env.DB,
      `INSERT INTO identifications (observation_id, taxon_slug, display_identification, identified_by, identified_at, evidence, is_current)
       VALUES (?, 'salticidae', 'Salticidae sp.', ?, date('now'), 'field', 1)`,
      obs.id,
      u.display_name,
    );
  }
  const cnt = await get<{ c: number }>(c.env.DB, "SELECT COUNT(*) AS c FROM revisions WHERE entity_type = 'observation' AND entity_id = ?", obs.public_id);
  await run(
    c.env.DB,
    "INSERT INTO revisions (entity_type, entity_id, version, action, data_snapshot, author) VALUES ('observation', ?, ?, '发布', ?, ?)",
    obs.public_id,
    (cnt?.c ?? 0) + 1,
    JSON.stringify({ at: new Date().toISOString() }),
    u.display_name,
  );
  await audit(c.env, u.display_name, 'observation', obs.public_id, 'observation.published', { from: obs.status, to: 'published' });
  // 规则 5/7：发布即自动提交仓库（push 触发公开站构建）；失败不影响本次发布，可手动重试
  c.executionCtx.waitUntil(
    syncToGitHub(c.env, obs.public_id).then((r) =>
      audit(c.env, u.display_name, 'github-sync', obs.public_id, r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
    ),
  );
  return c.json({ ok: true, public_url: `/observations/${obs.public_id}/`, status: 'published', sync: 'queued', warnings });
});

app.post('/studio/api/observations/:public_id/private', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT id, created_by, public_id, status FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能操作自己的记录。', 403);
  await transitionObservation(c.env, obs, 'private', u.display_name);
  queueSyncIfAffectsSite(c, c.env, obs.public_id, obs.status, 'private');
  return c.json({ ok: true, status: 'private' });
});

app.post('/studio/api/observations/:public_id/archive', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT id, created_by, public_id, status FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能操作自己的记录。', 403);
  await transitionObservation(c.env, obs, 'archived', u.display_name);
  queueSyncIfAffectsSite(c, c.env, obs.public_id, obs.status, 'archived');
  return c.json({ ok: true, status: 'archived' });
});

app.post('/studio/api/observations/:public_id/restore', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const obs = await get<any>(c.env.DB, 'SELECT id, created_by, public_id, status FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能操作自己的记录。', 403);
  if (obs.status !== 'archived') return c.json({ error: '只有已归档记录可以恢复' }, 400);
  await transitionObservation(c.env, obs, 'draft', u.display_name);
  return c.json({ ok: true, status: 'draft' });
});

// ---------- 个人资料（§26/§29：伙伴自助编辑公开资料与照片） ----------

app.get('/studio/profile', async (c) => {
  const u = user(c);
  const prof = await get<any>(c.env.DB, 'SELECT title, bio, photo_media_id FROM user_profiles WHERE user_id = ?', u.id);
  const photo = prof?.photo_media_id
    ? await get<{ public_id: string }>(c.env.DB, 'SELECT public_id FROM media WHERE id = ?', prof.photo_media_id)
    : undefined;
  return c.html(
    page('个人资料', `
  <div class="wrap narrow">
    <div class="hello-wrap"><h1>个人资料</h1><p>这些内容会随发布自动同步到主站的伙伴页。</p></div>
    <section class="field">
      <label>公开名称</label>
      <input id="p-name" value="${esc(u.display_name)}" />
      <span class="hint">主站署名用；修改后新发布的记录使用新名称。</span>
    </section>
    <section class="field">
      <label>身份头衔</label>
      <input id="p-title" value="${esc(prof?.title ?? '')}" placeholder="如：自然观察与摄影" />
    </section>
    <section class="field">
      <label>简介</label>
      <textarea id="p-bio" rows="4" placeholder="一两句话介绍你自己">${esc(prof?.bio ?? '')}</textarea>
    </section>
    <section class="field">
      <label>代表照片</label>
      <div class="photo-strip">
        <div class="photo-slot" id="photo-slot"${photo ? '' : ' data-empty'}>${photo ? `<img src="/media/derivatives/${esc(photo.public_id)}-480.jpg" alt="" />` : '＋<span>点击上传</span>'}</div>
        <span class="hint">点击上传或更换照片（JPG/PNG）</span>
      </div>
      <div class="field-error" id="photo-err"></div>
    </section>
    <div class="row-actions">
      <button type="button" class="primary" id="btn-save-profile">保存资料</button>
      <span id="profile-status" style="font-size:12.5px;color:var(--faint)"></span>
    </div>
  </div>
  <script src="/studio-profile.js"></script>`, u),
  );
});

app.get('/studio-profile.js', (c) =>
  c.body(PROFILE_SCRIPT, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));

app.post('/studio/api/profile', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const b = (await c.req.json()) as { display_name?: string; title?: string; bio?: string; photo_public_id?: string };
  const displayName = String(b.display_name ?? '').trim().slice(0, 40);
  if (!displayName) return c.json({ error: '公开名称不能为空' }, 400);
  await run(c.env.DB, 'UPDATE users SET display_name = ? WHERE id = ?', displayName, u.id);
  const title = String(b.title ?? '').trim().slice(0, 80) || null;
  const bio = String(b.bio ?? '').trim().slice(0, 400) || null;
  let photoMediaId: number | null = null;
  // 照片编号现行为 SN-YYYY-NNNNN；SFN-M-\d{6} 为迁移前历史格式（旧页面缓存仍可能发来，继续接受）
  if (b.photo_public_id && /^(?:SN-\d{4}-\d{5}|SFN-M-\d{6})$/.test(b.photo_public_id)) {
    const m = await get<{ id: number }>(c.env.DB, 'SELECT id FROM media WHERE public_id = ?', b.photo_public_id);
    photoMediaId = m?.id ?? null;
  }
  await run(
    c.env.DB,
    `INSERT INTO user_profiles (user_id, title, bio, photo_media_id, updated_at) VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET title = excluded.title, bio = excluded.bio,
       photo_media_id = COALESCE(excluded.photo_media_id, user_profiles.photo_media_id), updated_at = datetime('now')`,
    u.id,
    title,
    bio,
    photoMediaId,
  );
  await audit(c.env, u.display_name, 'profile', String(u.id), 'profile.updated', { display_name: displayName });
  // 公开资料改变主站伙伴页 → 自动同步（所有人可触发自己的同步）
  c.executionCtx.waitUntil(
    syncToGitHub(c.env, '个人资料').then((r) =>
      audit(c.env, u.display_name, 'github-sync', 'profile', r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
    ),
  );
  return c.json({ ok: true, sync: 'queued' });
});

// ---------- 地点实体（§14-§20）：搜索 / 新建（带去重）/ 合并 ----------

// ---------- 工作编号（§21-§24）：cf./aff./sp. 等未定名类群，鉴定可直接引用 ----------

app.post('/studio/api/taxa', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const b = (await c.req.json().catch(() => ({}))) as { name?: string; chinese_name?: string };
  const res = await createWorkingTaxon(c.env, String(b.name ?? ''), u.display_name, b.chinese_name ?? null);
  if (!res.ok) return c.json({ error: res.error }, res.status as 400 | 409);
  if (res.created) {
    await audit(c.env, u.display_name, 'taxon', res.taxon.slug, 'working-taxon.created', { name: res.taxon.name });
  } else if (res.cnUpdated) {
    // 协作者也可补录中文名（不动学名），记入审计流
    await audit(c.env, u.display_name, 'taxon', res.taxon.slug, 'working-taxon.cn-updated', { cn: res.taxon.cn });
  }
  return c.json({ ok: true, taxon: res.taxon, created: res.created, cnUpdated: res.cnUpdated === true });
});

// ---------- 工作编号管理（分类学变动流）：改名 / 合并 ----------

// WSC 输入预测（§22/§24）：属前缀 → 属列表；属名 → 该属 ACCEPTED 种列表
app.get('/studio/api/wsc/complete', async (c) => {
  user(c);
  const type = c.req.query('type') === 'species' ? 'species' : 'genus';
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  if (q.length < 2) return c.json({ ok: true, items: [] });
  const items = type === 'genus' ? await suggestGenera(c.env, q) : await suggestSpecies(c.env, q);
  if (items === null) return c.json({ ok: false, unreachable: true, items: [] });
  return c.json({ ok: true, items });
});

// 「我的观察」JSON 列表（微信小程序 / 其它原生客户端复用同一会话与数据）
app.get('/studio/api/observations', async (c) => {
  const u = user(c);
  const rows = await all<any>(
    c.env.DB,
    `SELECT o.public_id, o.observed_at, o.status, o.field_note,
            i.display_identification,
            p.name AS place_name, p.admin1, p.admin2, p.country AS country_name,
            (SELECT COUNT(*) FROM media m WHERE m.observation_id = o.id) AS photo_count
     FROM observations o
     LEFT JOIN identifications i ON i.observation_id = o.id AND i.is_current = 1
     LEFT JOIN places p ON p.id = o.place_id
     WHERE o.created_by = ? AND o.status != 'archived'
     ORDER BY o.observed_at DESC, o.id DESC
     LIMIT 100`,
    u.id,
  );
  return c.json({ ok: true, observations: rows });
});

app.patch('/studio/api/taxa/:slug', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.json({ error: '只有站长可以管理类群' }, 403);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const b = (await c.req.json().catch(() => ({}))) as { scientific_name?: string; chinese_name?: string | null };
  const res = await renameWorkingTaxon(c.env, c.req.param('slug'), String(b.scientific_name ?? ''), b.chinese_name);
  if (!res.ok) return c.json({ error: res.error }, res.status);
  await audit(c.env, u.display_name, 'taxon', c.req.param('slug'), 'working-taxon.renamed', { name: res.name });
  return c.json({ ok: true, taxon: { slug: c.req.param('slug'), name: res.name, cn: res.cn, rank: 'species', working: true } });
});

app.post('/studio/api/taxa/merge', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.json({ error: '只有站长可以管理类群' }, 403);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const b = (await c.req.json().catch(() => ({}))) as { from?: string; to?: string };
  const res = await mergeWorkingTaxon(c.env, String(b.from ?? ''), String(b.to ?? ''));
  if (!res.ok) return c.json({ error: res.error }, res.status);
  await audit(c.env, u.display_name, 'taxon', String(b.from), 'working-taxon.merged', {
    from: b.from,
    to: b.to,
    moved: res.moved,
  });
  return c.json({ ok: true, moved: res.moved, targetName: res.targetName });
});

// 一次性迁移：SFN-M-NNNNNN → SN-YYYY-NNNNNN（年取关联观察拍摄年，缺省当年）。
// 幂等：已是 SN- 的行跳过；完成后把按年计数器校准到已用最大序号。
// 存量照片指纹回填：为每条 media 的 R2 原图计算 SHA-256 入库（幂等）
app.post('/studio/api/migrate/backfill-photo-hash', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.json({ error: '只有站长可以执行迁移' }, 403);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const rows = await all<any>(c.env.DB, 'SELECT id, public_id, orig_ext FROM media ORDER BY id');
  let backfilled = 0, skipped = 0;
  const errs: string[] = [];
  for (const m of rows) {
    try {
      const obj = await c.env.MEDIA.get(`originals/${m.public_id}${m.orig_ext}`);
      if (!obj) { skipped++; continue; }
      const buf = await obj.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const done = await get<{ public_id: string }>(c.env.DB, 'SELECT public_id FROM photo_hashes WHERE hash = ?', hash);
      if (done) { skipped++; continue; }
      await run(c.env.DB, 'UPDATE media SET photo_hash = ? WHERE public_id = ?', hash, m.public_id);
      await run(c.env.DB, 'INSERT INTO photo_hashes (hash, public_id) VALUES (?, ?)', hash, m.public_id);
      backfilled++;
    } catch (e: any) {
      errs.push(`${m.public_id}: ${String(e?.message ?? e).slice(0, 120)}`);
      skipped++;
    }
  }
  await audit(c.env, u.display_name, 'media', null, 'photo-hash.backfill', { backfilled, skipped });
  return c.json({ ok: true, total: rows.length, backfilled, skipped, errors: errs.slice(0, 5) });
});

app.post('/studio/api/migrate/renumber-media', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.json({ error: '只有站长可以执行迁移' }, 403);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const rows = await all<any>(c.env.DB, "SELECT id, public_id, orig_ext, variants, observation_id FROM media WHERE public_id LIKE 'SFN-M-%' OR (public_id LIKE 'SN-%' AND LENGTH(public_id) = 14) ORDER BY id");
  const yearSeq: Record<number, number> = {};
  const mapping: { old: string; neo: string }[] = [];
  for (const m of rows) {
    const obsYear = m.observation_id
      ? (await get<{ y: string | null }>(c.env.DB, 'SELECT strftime("%Y", observed_at) AS y FROM observations WHERE id = ?', m.observation_id))?.y
      : null;
    const year = Number(obsYear) || new Date().getFullYear();
    // 幂等：目标号已被占用（部分成功过的重跑）则顺延，保证唯一
    let seq = (yearSeq[year] ?? 0) + 1;
    let neo = `SN-${year}-${String(seq).padStart(5, '0')}`;
    while (await get(c.env.DB, 'SELECT 1 FROM media WHERE public_id = ?', neo)) {
      seq += 1;
      neo = `SN-${year}-${String(seq).padStart(5, '0')}`;
    }
    yearSeq[year] = seq;
    mapping.push({ old: m.public_id, neo });
  }
  const errors: { id: string; step: string; message: string }[] = [];
  for (const { old: oldId, neo } of mapping) {
    try {
    const row = await get<any>(c.env.DB, 'SELECT orig_ext, variants FROM media WHERE public_id = ?', oldId);
    if (!row) continue;
    const ext = row.orig_ext || '.jpg';
    const orig = await c.env.MEDIA.get(`originals/${oldId}${ext}`);
    if (orig) {
      await c.env.MEDIA.put(`originals/${neo}${ext}`, orig.body, { httpMetadata: orig.httpMetadata });
      await c.env.MEDIA.delete(`originals/${oldId}${ext}`);
    }
    for (const v of JSON.parse(row.variants || '[]') as string[]) {
      const dv = await c.env.MEDIA.get(`derivatives/${oldId}-${v}`);
      if (dv) {
        await c.env.MEDIA.put(`derivatives/${neo}-${v}`, dv.body, { httpMetadata: dv.httpMetadata });
        await c.env.MEDIA.delete(`derivatives/${oldId}-${v}`);
      }
    }
    await run(c.env.DB, 'UPDATE media SET public_id = ?, file_stem = ? WHERE public_id = ?', neo, neo, oldId);
    await run(c.env.DB, 'UPDATE synced_originals SET public_id = ? WHERE public_id = ?', neo, oldId);
    // posts 表无 body_html 列（导出时即时渲染），只替换 body_md
    await run(c.env.DB, 'UPDATE posts SET body_md = REPLACE(body_md, ?, ?) WHERE body_md LIKE ?',
      `media:${oldId}`, `media:${neo}`, `%media:${oldId}%`);
    } catch (err: any) {
      errors.push({ id: oldId, step: 'migrate', message: String(err?.message ?? err) });
    }
  }
  for (const [year, n] of Object.entries(yearSeq)) {
    await run(c.env.DB,
      `INSERT INTO counters (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = MAX(value, excluded.value)`,
      `sfn-media-${year}`, n);
  }
  await audit(c.env, u.display_name, 'media', null, 'renumber-media', { count: mapping.length, errors: errors.length });
  if (errors.length) return c.json({ ok: false, migrated: mapping.length - errors.length, mapping, errors }, 500);
  return c.json({ ok: true, migrated: mapping.length, mapping });
});

app.post('/studio/api/wsc/revalidate', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.json({ error: '只有站长可以重校验' }, 403);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const stats = await runWscRevalidation(c.env);
  await audit(c.env, u.display_name, 'taxon', null, 'wsc.revalidated', stats);
  return c.json({ ok: true, ...stats });
});

app.get('/studio/taxa-manage', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.text('只有站长可以管理类群。', 403);
  const rows = await all<any>(
    c.env.DB,
    `SELECT w.*, (
       SELECT COUNT(*) FROM identifications i
       JOIN observations o ON o.id = i.observation_id
       WHERE i.taxon_slug = w.slug AND i.is_current = 1 AND o.status != 'archived'
     ) usage
     FROM working_taxa w WHERE w.status != 'merged' ORDER BY w.created_at, w.id`,
  );
  return c.html(taxaManagePage(rows, u));
});

app.get('/studio/api/places', async (c) => {
  user(c);
  const q = (c.req.query('q') ?? '').trim();
  const rows = q
    ? await all<any>(
        c.env.DB,
        `SELECT p.*, (SELECT COUNT(*) FROM observations o WHERE o.place_id = p.id AND o.status != 'archived') usage
         FROM places p
         WHERE p.merged_into_id IS NULL AND (p.name LIKE ? OR p.locality LIKE ? OR p.admin1 LIKE ? OR p.admin2 LIKE ?)
         ORDER BY p.name LIMIT 20`,
        `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`,
      )
    : await all<any>(
        c.env.DB,
        `SELECT p.*, (SELECT COUNT(*) FROM observations o WHERE o.place_id = p.id AND o.status != 'archived') usage
         FROM places p WHERE p.merged_into_id IS NULL ORDER BY p.name LIMIT 20`,
      );
  return c.json({ ok: true, places: rows });
});

app.post('/studio/api/places', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const b = (await c.req.json()) as Record<string, string | number | null>;
  const name = String(b.name ?? '').trim().slice(0, 120);
  if (!name) return c.json({ error: '地点名称不能为空' }, 400);
  const admin1 = String(b.admin1 ?? '').trim().slice(0, 60) || null;
  const admin2 = String(b.admin2 ?? '').trim().slice(0, 60) || null;
  const locality = String(b.locality ?? '').trim().slice(0, 120) || null;
  // §17 去重提示：同省同市同名 → 返回已有地点
  const dup = await get<any>(c.env.DB, "SELECT id, name, admin1, admin2, locality FROM places WHERE merged_into_id IS NULL AND name = ? AND COALESCE(admin1, '') = ? AND COALESCE(admin2, '') = ?", name, admin1 ?? '', admin2 ?? '');
  if (dup) return c.json({ ok: false, duplicate: true, existing: dup, error: '已存在相同地点，请直接选择' }, 409);
  const lat = b.latitude != null && b.latitude !== '' ? Number(b.latitude) : null;
  const lng = b.longitude != null && b.longitude !== '' ? Number(b.longitude) : null;
  const elev = b.elevation_m != null && b.elevation_m !== '' ? Number(b.elevation_m) : null;
  await run(
    c.env.DB,
    `INSERT INTO places (name, country, admin1, admin2, locality, site_name, latitude, longitude, elevation_m, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    name, String(b.country ?? '中国') || null, admin1, admin2, locality,
    String(b.site_name ?? '').trim().slice(0, 120) || null, lat, lng, elev, u.id,
  );
  const row = await get<any>(c.env.DB, 'SELECT id, name, admin1, admin2, locality, site_name, latitude, longitude, elevation_m FROM places WHERE id = last_insert_rowid()');
  await audit(c.env, u.display_name, 'place', String(row!.id), 'place.created', { name });
  return c.json({ ok: true, place: row });
});

// ---------- 数据质量（§13，quality control 而非审核） ----------

app.get('/studio/data', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.text('只有站长可以访问数据页。', 403);
  return c.html(dataPage(u));
});

app.get('/studio/quality', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.text('只有站长可以查看数据质量。', 403);
  const today = new Date().toISOString().slice(0, 10);
  const editUrl = (publicId: string) => `/studio/observations/${publicId}/edit`;
  const future = await all<any>(c.env.DB, "SELECT public_id, observed_at FROM observations WHERE observed_at > ? AND status != 'archived' ORDER BY observed_at", today);
  const noPlace = await all<any>(c.env.DB, "SELECT public_id, status FROM observations WHERE place_id IS NULL AND status != 'archived' ORDER BY public_id");
  const noGps = await all<any>(c.env.DB, "SELECT public_id FROM observations WHERE (exact_latitude IS NULL OR exact_longitude IS NULL) AND status = 'published' ORDER BY public_id");
  const wscFindings = await all<{ name: string; kind: string }>(
    c.env.DB,
    'SELECT name, kind FROM wsc_findings WHERE resolved = 0 ORDER BY created_at DESC LIMIT 20',
  );
  const dupPlaces = await all<any>(c.env.DB, "SELECT name, COUNT(*) c, GROUP_CONCAT(id) ids FROM places WHERE merged_into_id IS NULL GROUP BY lower(name) HAVING c > 1");
  const unidentified = await all<any>(c.env.DB, "SELECT o.public_id FROM observations o LEFT JOIN identifications i ON i.observation_id = o.id AND i.is_current = 1 WHERE o.status = 'published' AND i.id IS NULL ORDER BY o.public_id");
  const noPhotographer = await all<any>(c.env.DB, "SELECT public_id FROM media WHERE photographer_name IS NULL AND visibility = 'public'");
  const noCover = await all<any>(c.env.DB, "SELECT o.public_id FROM observations o WHERE o.status = 'published' AND NOT EXISTS (SELECT 1 FROM media m WHERE m.observation_id = o.id AND m.is_cover = 1)");
  type QRow = { text: string; href?: string };
  const sections: { label: string; hint: string; rows: QRow[] }[] = [
    { label: '未来日期', hint: '确认是误填就改掉；确实要提前发布的可以保留。', rows: future.map((r) => ({ text: `${r.public_id}（${r.observed_at}）`, href: editUrl(r.public_id) })) },
    { label: '未挂接地点', hint: '在编辑页的地点搜索里选择或新建。', rows: noPlace.map((r) => ({ text: `${r.public_id}（${r.status}）`, href: editUrl(r.public_id) })) },
    { label: '已发布但缺 GPS', hint: '有可靠坐标再补；没有就不显示坐标。', rows: noGps.map((r) => ({ text: r.public_id, href: editUrl(r.public_id) })) },
    { label: '疑似重复地点', hint: '同名地点建议在「地点管理」里合并。', rows: dupPlaces.map((r) => ({ text: `${r.name} ×${r.c}`, href: '/studio/places-manage' })) },
    { label: '已发布但未鉴定', hint: '未知是一等公民，不急。', rows: unidentified.map((r) => ({ text: r.public_id, href: editUrl(r.public_id) })) },
    { label: '公开影像缺摄影者', hint: '每张照片都该有署名。', rows: noPhotographer.map((r) => ({ text: r.public_id, href: editUrl(r.obs ?? r.public_id) })) },
    { label: '已发布但无封面图', hint: '没有封面不影响公开，但列表里不好看。', rows: noCover.map((r) => ({ text: r.public_id, href: editUrl(r.public_id) })) },
    { label: 'WSC 变动', hint: 'World Spider Catalog 侧检测到分类学变动——确认后在「类群管理」改名或合并。', rows: wscFindings.map((f) => ({ text: `${f.name}（${f.kind === 'genus-missing' ? '属名查无' : '种组合查无'}）`, href: '/studio/taxa-manage' })) },
  ];
  const body = sections
    .map(
      (sec) => `<section class="field">
        <label>${esc(sec.label)}（${sec.rows.length}）</label>
        ${sec.rows.length ? `<div class="q-rows">${sec.rows.map((r) => `<div class="q-row">${r.href ? `<a href="${r.href}">${esc(r.text)} →</a>` : esc(r.text)}</div>`).join('')}</div>` : '<p class="empty">没有问题 ✓</p>'}
        <span class="hint">${esc(sec.hint)}</span>
      </section>`,
    )
    .join('');
  return c.html(
    page('数据质量', `
  <div class="wrap">
    <div class="hello-wrap"><h1>数据质量</h1><p>Quality control，不是审核——帮你找到需要补齐的记录。</p></div>
    ${body}
  </div>`, u),
  );
});

// ---------- 地点管理（owner：合并重复地点，§20） ----------

app.get('/studio/places-manage', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.text('只有站长可以管理地点。', 403);
  const rows = await all<any>(
    c.env.DB,
    `SELECT p.*, (SELECT COUNT(*) FROM observations o WHERE o.place_id = p.id AND o.status != 'archived') usage
     FROM places p WHERE p.merged_into_id IS NULL ORDER BY p.name`,
  );
  const options = rows
    .map((x) => `<option value="${x.id}">${esc(x.name)}</option>`)
    .join('');
  const rowsHtml = rows
    .map(
      (p) => `<div class="pm-row">
        <div class="pm-main"><b>${esc(p.name)}</b><span class="pm-sub">${esc([p.admin1, p.admin2, p.locality].filter(Boolean).join(' · ') || '—')}${p.latitude != null ? ' · ' + p.latitude + ', ' + p.longitude : ''}</span></div>
        <div class="pm-side"><span class="pm-count">${p.usage} 条观察</span>
          <select class="pm-target" data-from="${p.id}"><option value="">合并到…</option>${rows
            .filter((x) => x.id !== p.id)
            .map((x) => `<option value="${x.id}">${esc(x.name)}</option>`)
            .join('')}</select>
          <button type="button" class="act-btn" data-merge-from="${p.id}">合并</button>
        </div>
      </div>`,
    )
    .join('');
  return c.html(
    page('地点管理', `
  <div class="wrap">
    <div class="hello-wrap"><h1>地点管理</h1><p>同一个地方因为写法不同产生多条时，在这里合并。观察会整体迁移，不会丢。</p></div>
    ${rows.length ? `<div class="place-manage">${rowsHtml}</div>` : '<p class="empty">还没有地点。</p>'}
  </div>
  <script>
  (function () {
    Array.prototype.slice.call(document.querySelectorAll('button[data-merge-from]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var from = b.getAttribute('data-merge-from');
        var sel = document.querySelector('.pm-target[data-from="' + from + '"]');
        var to = sel ? sel.value : '';
        if (!to) { alert('先选择合并到的地点'); return; }
        if (!confirm('确定合并？该地点的全部观察会迁移到目标地点。')) return;
        b.disabled = true;
        fetch('/studio/api/places/merge', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: Number(from), to: Number(to) }),
        })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j && j.ok) location.reload();
            else { b.disabled = false; alert((j && j.error) || '合并失败'); }
          })
          .catch(function () { b.disabled = false; alert('网络异常，请重试'); });
      });
    });
  })();
  </script>`, u),
  );
});

app.post('/studio/api/places/merge', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  if (u.role !== 'owner') return c.json({ error: '只有站长可以合并地点' }, 403);
  const b = (await c.req.json()) as { from?: number; to?: number };
  const from = Number(b.from), to = Number(b.to);
  if (!from || !to || from === to) return c.json({ error: '参数错误' }, 400);
  const target = await get<any>(c.env.DB, 'SELECT id FROM places WHERE id = ? AND merged_into_id IS NULL', to);
  if (!target) return c.json({ error: '目标地点不存在' }, 404);
  await run(c.env.DB, 'UPDATE observations SET place_id = ? WHERE place_id = ?', to, from);
  await run(c.env.DB, "UPDATE places SET merged_into_id = ?, updated_at = datetime('now') WHERE id = ?", to, from);
  await audit(c.env, u.display_name, 'place', String(from), 'place.merged', { from, to });
  c.executionCtx.waitUntil(
    syncToGitHub(c.env, '地点合并').then((r) =>
      audit(c.env, u.display_name, 'github-sync', 'places', r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
    ),
  );
  return c.json({ ok: true });
});

// ---------- EXIF 预读 ----------


app.post('/studio/api/exif-preview', async (c) => {
  const u = user(c);
  const fd = await c.req.formData();
  const file = fd.get('photo');
  if (!(file instanceof File)) return c.json({ error: 'no photo' }, 400);
  const s = await parseExif(await file.arrayBuffer());
  return c.json({ results: [{ filename: file.name, date: s.date ?? null, datetime: s.datetime ?? null, gps: s.gps ?? null, camera: s.camera ?? null }] });
});

// ---------- 札记 ----------

app.post('/studio/api/notes', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const seq = await nextCounter(c.env.DB, 'post');
  const body = (await c.req.json()) as Record<string, string>;
  const slug = `note-${String(seq).padStart(3, '0')}`;
  await run(c.env.DB, 'INSERT INTO posts (slug, author_id, title, subtitle, body_md, status) VALUES (?,?,?,?,?,?)', slug, u.id, String(body.title ?? '未命名札记').slice(0, 160), body.subtitle ?? null, String(body.body_md ?? ''), 'draft');
  await audit(c.env, u.display_name, 'post', slug, 'create-draft');
  return c.json({ ok: true, slug, edit_url: `/studio/notes/${slug}/edit` });
});

/** 「关联观察」输入归一：逗号/分号/空白分隔 → 合法 SFN/CSFN 编号数组（去重、限 20 个） */
function parseRelatedIds(raw: unknown): string[] {
  const text = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  const out: string[] = [];
  for (const tok of text.split(/[,，;；\s]+/)) {
    const t = tok.trim().toUpperCase();
    if (/^(CSFN|SFN)-\d{4}-\d{6}$/.test(t) && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}

app.patch('/studio/api/notes/:slug', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const post = await get<any>(c.env.DB, 'SELECT * FROM posts WHERE slug = ?', c.req.param('slug'));
  if (!post) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && post.author_id !== u.id) return c.json({ error: '只能编辑自己的札记' }, 403);
  const body = (await c.req.json()) as Record<string, unknown>;
  const related = parseRelatedIds(body.related_observation_public_ids);
  await run(
    c.env.DB,
    "UPDATE posts SET title = ?, subtitle = ?, body_md = ?, related_observation_public_ids = ?, updated_at = datetime('now') WHERE id = ?",
    String(body.title ?? '').slice(0, 160),
    typeof body.subtitle === 'string' ? body.subtitle : null,
    String(body.body_md ?? ''),
    JSON.stringify(related),
    post.id,
  );
  // 已发布札记的显式保存：审计 + 立即同步主站（§29）
  if (post.status === 'published' && body.explicit === true) {
    await audit(c.env, u.display_name, 'post', post.slug, 'post.updated', {});
    c.executionCtx.waitUntil(
      syncToGitHub(c.env, post.slug).then((r) =>
        audit(c.env, u.display_name, 'github-sync', post.slug, r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
      ),
    );
    return c.json({ ok: true, saved_at: new Date().toISOString().slice(11, 19), sync: 'queued' });
  }
  return c.json({ ok: true, saved_at: new Date().toISOString().slice(11, 19) });
});

app.post('/studio/api/notes/:slug/publish', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const post = await get<any>(c.env.DB, 'SELECT * FROM posts WHERE slug = ?', c.req.param('slug'));
  if (!post) return c.json({ error: '未找到' }, 404);
  if (u.role !== 'owner' && post.author_id !== u.id) return c.json({ error: '只能发布自己的札记' }, 403);
  if (!String(post.title ?? '').trim() || !String(post.body_md ?? '').trim()) {
    return c.json({ error: '发布前至少需要标题与正文' }, 400);
  }
  await run(c.env.DB, "UPDATE posts SET status = 'published', published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", post.id);
  const cnt = await get<{ c: number }>(c.env.DB, "SELECT COUNT(*) AS c FROM revisions WHERE entity_type = 'post' AND entity_id = ?", post.slug);
  await run(c.env.DB, "INSERT INTO revisions (entity_type, entity_id, version, action, author) VALUES ('post', ?, ?, '发布札记', ?)", post.slug, (cnt?.c ?? 0) + 1, u.display_name);
  await audit(c.env, u.display_name, 'post', post.slug, 'publish');
  // 同观察发布：自动同步仓库，push 触发公开站构建
  c.executionCtx.waitUntil(
    syncToGitHub(c.env, post.slug).then((r) =>
      audit(c.env, u.display_name, 'github-sync', post.slug, r.ok ? 'sync-ok: ' + r.detail : 'sync-fail: ' + r.detail),
    ),
  );
  return c.json({ ok: true, public_url: `/posts/${post.slug}/`, sync: 'queued' });
});

// 预览：真实 Article Renderer（与公开站导出共用）
app.post('/studio/api/notes/preview', async (c) => {
  const u = user(c);
  const body = (await c.req.json()) as { body_md?: string };
  const resolvers = await buildResolvers(c.env, String(body.body_md ?? ''));
  const html = renderArticle(String(body.body_md ?? ''), resolvers);
  return c.json({ html });
});

// ---------- 观察编辑器页面 ----------

app.get('/studio/observations/new', async (c) => {
  user(c);
  return c.html(obsEditorHtml(null, {}, [], { status: 'draft', hasUnpublished: false, photoMeta: [] }, await allTaxonOptions(c.env)));
});

app.get('/studio/observations/:public_id/edit', async (c) => {
  const u = user(c);
  const obs = await get<any>(c.env.DB, 'SELECT * FROM observations WHERE public_id = ?', c.req.param('public_id'));
  if (!obs) return c.text('未找到该观察。', 404);
  if (u.role !== 'owner' && obs.created_by !== u.id) return c.text('只能编辑自己的记录。', 403);
  const photos = await mediaForObservation(c.env, obs.id);
  const idn = await get<{ taxon_slug: string }>(c.env.DB, 'SELECT taxon_slug FROM identifications WHERE observation_id = ? AND is_current = 1', obs.id);
  const place = obs.place_id
    ? await get<{ name: string }>(c.env.DB, 'SELECT name FROM places WHERE id = ?', obs.place_id)
    : undefined;
  const data = {
    ...obs,
    observed_at: String(obs.observed_at ?? '').slice(0, 10),
    latitude: obs.exact_latitude ?? '',
    longitude: obs.exact_longitude ?? '',
    species_taxon_slug: idn?.taxon_slug ?? '',
    placeName: place?.name ?? '',
  };
  const grid = photos.map((p) => ({
    public_id: p.public_id, thumb: thumbUrl(p), caption: p.caption,
    photographer_name: p.photographer_name, is_cover: p.is_cover, view_type: p.view_type,
  }));
  const bootMeta = {
    status: obs.status,
    hasUnpublished: obs.status === 'published' && String(obs.updated_at ?? '') > String(obs.published_at ?? ''),
    photoMeta: grid.map((g) => ({ public_id: g.public_id, caption: g.caption, photographer_name: g.photographer_name, view_type: g.view_type })),
  };
  return c.html(obsEditorHtml(obs.public_id, data, grid, bootMeta, await allTaxonOptions(c.env)));
});

// ---------- 札记编辑器页面 ----------

// 批量导入：整批照片按拍摄时间分组，一组一条观察草稿
app.get('/studio/import', async (c) => {
  const u = user(c);
  return c.html(importPage(u));
});

app.get('/studio/notes/new', async (c) => {
  const u = user(c);
  return c.html(noteEditorHtml('', { title: '', subtitle: '', body_md: '', status: 'draft', author_name: u.display_name, related: '' }));
});

app.get('/studio/notes/:slug/edit', async (c) => {
  const u = user(c);
  const post = await get<any>(c.env.DB, 'SELECT * FROM posts WHERE slug = ?', c.req.param('slug'));
  if (!post) return c.text('未找到该札记。', 404);
  if (u.role !== 'owner' && post.author_id !== u.id) return c.text('只能编辑自己的札记。', 403);
  return c.html(noteEditorHtml(post.slug, {
    ...post,
    author_name: u.display_name,
    related: String(post.related_observation_public_ids ?? '[]').replace(/[\[\]"]/g, ''),
  }));
});

// ---------- 媒体管理 ----------

app.get('/studio/media', async (c) => {
  const u = user(c);
  const rows = await all<MediaRow & { obs_public_id: string | null }>(
    c.env.DB,
    `SELECT m.*, o.public_id AS obs_public_id FROM media m
     LEFT JOIN observations o ON o.id = m.observation_id
     WHERE m.visibility = 'public' ORDER BY m.id DESC LIMIT 200`,
  );
  const obsCount = await get<{ c: number }>(c.env.DB, "SELECT COUNT(*) AS c FROM observations WHERE status = 'published'");
  const postCount = await get<{ c: number }>(c.env.DB, "SELECT COUNT(*) AS c FROM posts WHERE status = 'published'");
  return c.html(
    mediaPage(
      rows.map((m) => ({ public_id: m.public_id, thumb: thumbUrl(m), obs_public_id: m.obs_public_id })),
      u.role === 'owner',
      { observations: obsCount?.c ?? 0, posts: postCount?.c ?? 0 },
      u,
    ),
  );
});

// 照片元信息（图注 / 摄影者）
app.patch('/studio/api/media/:public_id', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const m = await mediaByPublicId(c.env, c.req.param('public_id'));
  if (!m) return c.json({ error: '未找到' }, 404);
  const obs = m.observation_id ? await get<{ created_by: number }>(c.env.DB, 'SELECT created_by FROM observations WHERE id = ?', m.observation_id) : undefined;
  if (u.role !== 'owner' && (!obs || obs.created_by !== u.id)) return c.text('无权操作。', 403);
  const body = (await c.req.json()) as { caption?: string; photographer_name?: string; view_type?: string };
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.caption === 'string') { sets.push('caption = ?'); vals.push(body.caption.slice(0, 300)); }
  if (typeof body.photographer_name === 'string') { sets.push('photographer_name = ?'); vals.push(body.photographer_name.slice(0, 80)); }
  if (typeof body.view_type === 'string' && /^[a-z_]+$/.test(body.view_type)) { sets.push('view_type = ?'); vals.push(body.view_type); }
  if (sets.length) await run(c.env.DB, `UPDATE media SET ${sets.join(', ')} WHERE id = ?`, ...vals, m.id);
  return c.json({ ok: true });
});

// ---------- 邀请伙伴（规则 11：仅站长可邀请） ----------

app.get('/studio/invite', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.text('只有站长可以管理邀请。', 403);
  const rows = await all<any>(
    c.env.DB,
    'SELECT code, label, email, claimed_by FROM invitations ORDER BY id DESC',
  );
  return c.html(page('邀请伙伴', invitePage(rows, c.req.query('ok') ? '已加入受邀名单 ✓' : null), u));
});

app.post('/studio/invite', async (c) => {
  const u = user(c);
  if (u.role !== 'owner') return c.text('只有站长可以管理邀请。', 403);
  if (!sameOrigin(c.req.raw)) return c.text('Forbidden', 403);
  const form = await c.req.parseBody();
  const label = String((form as any).label ?? '').trim().slice(0, 40);
  const email = String((form as any).email ?? '').trim().toLowerCase();
  const fail = async (msg: string) => {
    const rows = await all<any>(c.env.DB, 'SELECT code, label, email, claimed_by FROM invitations ORDER BY id DESC');
    return c.html(page('邀请伙伴', invitePage(rows, msg), u));
  };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('邮箱格式不正确。');
  const dup = await get(c.env.DB, 'SELECT id FROM invitations WHERE lower(email) = ?', email);
  if (dup) return fail('该邮箱已在受邀名单中。');
  const code = `INV-${new Date().getFullYear()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  await run(c.env.DB, 'INSERT INTO invitations (code, label, email) VALUES (?, ?, ?)', code, label || null, email);
  await audit(c.env, u.display_name, 'invitation', email, 'invite', { label });
  return c.redirect('/studio/invite?ok=1');
});

// ---------- 导出（zip：JSON + 新增原图） ----------

// 手动同步：把当前已发布内容整体提交到仓库并触发公开站构建（发布时自动做过，失败可在此重试）
app.post('/studio/api/sync', async (c) => {
  const u = user(c);
  if (!sameOrigin(c.req.raw)) return c.json({ error: 'Forbidden' }, 403);
  const r = await syncToGitHub(c.env);
  await audit(c.env, u.display_name, 'github-sync', null, r.ok ? 'manual-ok: ' + r.detail : 'manual-fail: ' + r.detail);
  return c.json(r, r.ok ? 200 : 500);
});

app.get('/studio/export', async (c) => {
  const u = requireOwner(c);
  if (!u) return;
  const zip = await buildExportZip(c.env);
  await audit(c.env, u.display_name, 'export', null, 'export-zip');
  const date = new Date().toISOString().slice(0, 10);
  return c.body(zip as unknown as ArrayBuffer, 200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="studio-export-${date}.zip"`,
  });
});

// ---------- 404 ----------

app.notFound((c) => c.text('Not Found', 404));

export default {
  fetch: app.fetch,
  // 周任务（cron：UTC 周一 21:00）：清缓存后重校验全部已发布正式学名，检测 WSC 端分类学变动。
  // 变动写入 wsc_findings（数据质量页呈现）；改名动作仍由站长在「类群管理」一键执行——
  // 分类学判断保留人工确认，机器只负责发现与提醒。
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    ctx.waitUntil(runWscRevalidation(env));
  },
};

/** WSC 周重校验主体：清缓存 → 重验已发布正式学名 → 与旧状态比对写 findings。cron 与手动触发共用。 */
export async function runWscRevalidation(env: Env): Promise<{ checked: number; newFindings: number }> {
    {
      const { all, run } = await import('./db');
      const previous = new Map<string, { exists: boolean; status: string | null }>();
      const oldRows = await all<{ name: string; exists_wsc: number; status: string | null }>(
        env.DB, 'SELECT name, exists_wsc, status FROM wsc_cache',
      );
      for (const r of oldRows) previous.set(r.name, { exists: r.exists_wsc === 1, status: r.status });
      await run(env.DB, "DELETE FROM wsc_cache");

      const rows = await all<{ slug: string; display: string }>(
        env.DB,
        `SELECT DISTINCT i.taxon_slug AS slug, i.display_identification AS display
         FROM identifications i JOIN observations o ON o.id = i.observation_id
         WHERE i.is_current = 1 AND o.status = 'published'`,
      );
      const currentProblems = new Set<string>();
      let wscFindingsCreated = 0;
      for (const row of rows) {
        if (!row.slug) continue;
        const v = await validateFormalName(env, row.display);
        if (!v.checked) continue;
        const gKey = 'g:' + row.display.split(/\s+/)[0].toLowerCase();
        const nowGenus = v.genusKnown;
        const before = previous.get(gKey);
        // 属名从有到无：WSC 端属级变动（拆分/移出）
        if (before && before.exists && !nowGenus) {
          currentProblems.add(row.slug + ':genus-missing');
          const dup = await get(env.DB, "SELECT id FROM wsc_findings WHERE slug = ? AND kind = 'genus-missing' AND resolved = 0", row.slug);
          if (!dup) {
            wscFindingsCreated++;
            await run(env.DB,
              "INSERT INTO wsc_findings (slug, name, kind, detail) VALUES (?,?,?,?)",
              row.slug, row.display, 'genus-missing',
              `WSC 现查不到属名——该属可能已被拆分或转移，请核对当前有效名。`);
            await audit(env, 'wsc-cron', 'taxon', row.slug, 'wsc.genus-missing', { name: row.display });
          }
        }
        if (v.speciesKnown === false) {
          // 种组合查无：可能被同物异名合并或转移；与上次状态比对，仅记录真实变动
          const beforeS = previous.get('s:' + row.display.toLowerCase());
          if (beforeS && beforeS.exists) {
            currentProblems.add(row.slug + ':species-missing');
            const dup = await get(env.DB, "SELECT id FROM wsc_findings WHERE slug = ? AND kind = 'species-missing' AND resolved = 0", row.slug);
            if (!dup) {
              wscFindingsCreated++;
              await run(env.DB,
                "INSERT INTO wsc_findings (slug, name, kind, detail) VALUES (?,?,?,?)",
                row.slug, row.display, 'species-missing',
                `WSC 现查不到该组合——可能已沦为异名或转移至他属，请按 WSC 当前有效名更正。`);
              await audit(env, 'wsc-cron', 'taxon', row.slug, 'wsc.species-missing', { name: row.display });
            }
          }
        }
      }
      // finding 收敛：仍在问题中的保持未解决；已恢复的自动关闭；新增问题插入
      const unresolved = await all<{ id: number; slug: string; kind: string }>(
        env.DB, 'SELECT id, slug, kind FROM wsc_findings WHERE resolved = 0',
      );
      const stillBroken = new Set(currentProblems);
      for (const f of unresolved) {
        if (!stillBroken.has(f.slug + ':' + f.kind)) {
          await run(env.DB, 'UPDATE wsc_findings SET resolved = 1 WHERE id = ?', f.id);
        }
      }
      return { checked: rows.length, newFindings: wscFindingsCreated };
    }
}

