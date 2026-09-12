// 媒体存储（R2）：原图不可变（规则 20），派生图由浏览器端 canvas 生成后成对上传。
// 派生图命名 <SFN-M-NNNNNN>-<宽>.<jpg|webp|avif>；缩略/预览取最小宽 jpg / 最接近 1280 的 jpg。
import { all, get, nextCounter, pad6, run, type Env, type Row } from './db';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_ORIGINAL_BYTES = 40 * 1024 * 1024;
const MAX_VARIANT_BYTES = 8 * 1024 * 1024;
const MAX_VARIANTS = 12;

export interface UploadInput {
  original: File;
  width: number;
  height: number;
  variants: { name: string; blob: Blob }[]; // name 形如 "480.jpg"
}

export interface SaveResult {
  publicId: string;
  fileStem: string;
  width: number;
  height: number;
}

function bad(msg: string): never {
  throw new Error(msg);
}

/** 存储一张上传图：R2 原图（永不覆盖）+ R2 派生图 + D1 media 行 */
export async function saveUpload(
  env: Env,
  photographer: string,
  input: UploadInput,
  ref: { observationId: number | null; noteSlug: string | null; publicVisibility: boolean },
): Promise<SaveResult> {
  const f = input.original;
  if (!f || !ALLOWED_TYPES.has(f.type)) bad('只接受 JPG / PNG 原图');
  if (f.size > MAX_ORIGINAL_BYTES) bad('原图超过 40MB 上限');
  if (!Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width < 1 || input.height < 1) bad('缺少图片尺寸');
  if (input.variants.length === 0 || input.variants.length > MAX_VARIANTS) bad('派生图数量不合法');
  for (const v of input.variants) {
    if (v.blob.size > MAX_VARIANT_BYTES) bad(`派生图 ${v.name} 超过 8MB 上限`);
    if (!/^\d{3,4}\.(jpg|webp|avif)$/.test(v.name)) bad(`派生图命名不合法：${v.name}`);
  }

  // 内容指纹（SHA-256）：同一张原图全站只允许上传一次；删除后指纹保留，编号永不复用
  const bytes = await f.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const photoHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  const dup = await get<{ public_id: string; deleted: number }>(
    env.DB,
    'SELECT public_id, deleted FROM photo_hashes WHERE hash = ?',
    photoHash,
  );
  if (dup) {
    bad(dup.deleted
      ? `这张照片曾以编号 ${dup.public_id} 上传过（已删除）。编号不复用，同一张照片不能再次上传`
      : `这张照片已经上传过：编号 ${dup.public_id}。同一张照片不能重复上传`);
  }

  // 编号体系（2026-09）：只有照片对外编号 SN-YYYY-NNNNN（按年计数）；观察不再对外编号
  const year = new Date().getFullYear();
  const seq = await nextCounter(env.DB, `sfn-media-${year}`);
  const publicId = `SN-${year}-${String(seq).padStart(5, '0')}`;
  const ext = f.type === 'image/png' ? '.png' : '.jpg';
  const origKey = `originals/${publicId}${ext}`;

  // 规则 20：原图永不覆盖——先查再写，撞号即失败
  if (await env.MEDIA.head(origKey)) bad('编号冲突：同名原图已存在，请重试');
  await env.MEDIA.put(origKey, bytes, { httpMetadata: { contentType: f.type } });

  const variantNames: string[] = [];
  for (const v of input.variants) {
    await env.MEDIA.put(`derivatives/${publicId}-${v.name}`, v.blob.stream(), {
      httpMetadata: { contentType: v.name.endsWith('.webp') ? 'image/webp' : v.name.endsWith('.avif') ? 'image/avif' : 'image/jpeg' },
    });
    variantNames.push(v.name);
  }

  await run(
    env.DB,
    `INSERT INTO media (public_id, observation_id, note_slug, file_stem, orig_ext, variants, view_type, caption,
       sort_order, is_cover, photographer_name, license, visibility, width, height, photo_hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    publicId,
    ref.observationId,
    ref.noteSlug,
    publicId,
    ext,
    JSON.stringify(variantNames),
    'live_dorsal',
    null,
    1,
    0,
    photographer,
    'all_rights_reserved',
    ref.publicVisibility ? 'public' : 'private',
    Math.round(input.width),
    Math.round(input.height),
    photoHash,
  );

  // 指纹注册：后续同图重传一律拒绝；删除照片后本行保留（编号烧毁）
  await run(
    env.DB,
    'INSERT OR IGNORE INTO photo_hashes (hash, public_id) VALUES (?, ?)',
    photoHash, publicId,
  );
  return { publicId, fileStem: publicId, width: Math.round(input.width), height: Math.round(input.height) };
}

export interface MediaRow extends Row {
  id: number;
  public_id: string;
  file_stem: string;
  orig_ext: string;
  variants: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  visibility: string;
}

/** 缩略图 URL：最小宽 jpg（画布必产 480 档；极端小图时为唯一档） */
export function thumbUrl(m: MediaRow): string {
  const variants = safeVariants(m.variants);
  const jpgs = variants.filter((v) => v.endsWith('.jpg')).map((v) => parseInt(v, 10)).sort((a, b) => a - b);
  const w = jpgs[0] ?? 480;
  return `/media/derivatives/${m.file_stem}-${w}.jpg`;
}

/** 文章引用 URL：最接近 1280 且不超过的 jpg 档；不足则最大档 */
export function articleUrl(m: MediaRow): string {
  const variants = safeVariants(m.variants);
  const jpgs = variants
    .filter((v) => v.endsWith('.jpg'))
    .map((v) => parseInt(v, 10))
    .sort((a, b) => a - b)
    // 原图宽度上限保护：不允许引用超过原图宽度的档位（避免公开站生成不存在的文件）
    .filter((w) => m.width == null || w <= m.width);
  if (jpgs.length === 0) return thumbUrl(m);
  const fit = jpgs.filter((w) => w <= 1280);
  const w = (fit.length ? fit : jpgs)[(fit.length ? fit : jpgs).length - 1];
  return `/media/derivatives/${m.file_stem}-${w}.jpg`;
}

function safeVariants(json: string): string[] {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? (v as string[]) : [];
  } catch {
    return [];
  }
}

export async function mediaByPublicId(env: Env, publicId: string): Promise<MediaRow | undefined> {
  return get<MediaRow>(env.DB, 'SELECT * FROM media WHERE public_id = ?', publicId);
}

export async function mediaForObservation(env: Env, obsRowId: number): Promise<MediaRow[]> {
  return all<MediaRow>(env.DB, 'SELECT * FROM media WHERE observation_id = ? ORDER BY sort_order', obsRowId);
}
