// 导出：把已发布内容打成一个 zip（JSON + 原图 + 说明），由站长解压进仓库再构建发布。
// 设计：远程 Studio 不持有 GitHub 凭据（v1）；GitHub 仍是唯一源码真源（规则 5）。
import { zipSync, strToU8 } from 'fflate';
import { all, get, type Env } from './db';
import { renderBody } from './embeds';
import taxaJson from './taxa-data.json';
import { workingTaxaRows, type WorkingTaxonRow } from './taxa';

const README = `跳蛛观察志 · Field Studio 导出包

内容：
  studio-places.json           → src/data/studio-places.json
  studio-taxa.json             → src/data/studio-taxa.json（工作编号，§21-§24）
  studio-profiles.json          → src/data/studio-profiles.json
  studio-observations.json     → src/data/studio-observations.json
  studio-locations.json        → src/data/studio-locations.json
  studio-media.json            → src/data/studio-media.json
  studio-identifications.json  → src/data/studio-identifications.json
  studio-posts.json            → src/data/studio-posts.json
  originals/                   → media/originals/（新增编号的原图，已存在的编号直接覆盖同名新文件即可）

步骤：
  1. 把上述文件放入仓库对应位置；
  2. npm run build && npm run test:privacy（必须通过）；
  3. git commit && git push —— Cloudflare 自动构建上线。

坐标口径（Studio SOP §7）：观察坐标全量精确公开；未发布记录不会出现在导出中。
`;

// 授权邮箱 ↔ 稳定公开档案（§26/§28）；观察归属按创建者邮箱映射到对应档案
export const EMAIL_PROFILE: Record<string, string> = {
  'yangzy0124@gmail.com': 'prof-zhiyong',
  'wayhungwang@163.com': 'prof-hamu',
  'nyarlatis@163.com': 'prof-yi',
};

export interface ExportData {
  placesJson: string;
  taxaJson: string;
  profilesJson: string;
  observationsJson: string;
  locationsJson: string;
  mediaJson: string;
  identificationsJson: string;
  postsJson: string;
  /** key 形如 originals/SFN-M-000001.jpg */
  originals: Record<string, Uint8Array>;
}

export async function collectExport(env: Env): Promise<ExportData> {
  const observations = await all(env.DB, "SELECT * FROM observations WHERE status = 'published' AND visibility = 'public' ORDER BY public_id");
  const wtBySlug = new Map((await workingTaxaRows(env)).map((t) => [t.slug, t]));
  const referencedWorking = new Map<string, WorkingTaxonRow>();

  const mediaOut: unknown[] = [];
  const identificationsOut: unknown[] = [];
  const originalFiles: Record<string, Uint8Array> = {};
  const exportedMediaIds = new Set<string>();

  // 观察归属：按创建者邮箱映射稳定档案；未知邮箱回落站长档案
  const creatorProfile = new Map<number, string>();
  for (const o of observations) {
    if (creatorProfile.has(o.created_by)) continue;
    const u = await get<{ email: string | null }>(env.DB, 'SELECT email FROM users WHERE id = ?', o.created_by);
    creatorProfile.set(o.created_by, (u?.email && EMAIL_PROFILE[u.email.toLowerCase()]) || 'prof-zhiyong');
  }

  for (const o of observations) {
    const mediaRows = await all<any>(env.DB, 'SELECT * FROM media WHERE observation_id = ? ORDER BY sort_order', o.id);
    for (const m of mediaRows) {
      exportedMediaIds.add(m.public_id);
      mediaOut.push({
        id: m.public_id,
        public_id: m.public_id,
        observation_id: `studio-${o.id}`,
        source_original: `media/originals/${m.public_id}${m.orig_ext}`,
        view_type: m.view_type,
        caption: m.caption,
        sort_order: m.sort_order,
        is_cover: Boolean(m.is_cover),
        photographer_profile_id: null,
        photographer_name: m.photographer_name || creatorProfile.get(o.created_by) || null,
        license: m.license,
        visibility: 'public',
      });
      const obj = await env.MEDIA.get(`originals/${m.public_id}${m.orig_ext}`);
      if (obj) originalFiles[`originals/${m.public_id}${m.orig_ext}`] = new Uint8Array(await obj.arrayBuffer());
    }
    const idn = await get<any>(env.DB, 'SELECT * FROM identifications WHERE observation_id = ? AND is_current = 1 LIMIT 1', o.id);
    if (idn && idn.taxon_slug) {
      // 规则 6：只有引用 taxon 记录的鉴定才是权威鉴定；slug 先映射静态站类群，工作编号兜底（§21-§24）
      const staticTaxon = (taxaJson as { id: string; slug: string }[]).find((t) => t.slug === idn.taxon_slug);
      let taxonId: string;
      if (staticTaxon) {
        taxonId = staticTaxon.id;
      } else {
        const wt = wtBySlug.get(idn.taxon_slug);
        if (!wt) throw new Error(`未知 taxon slug：${idn.taxon_slug}`);
        referencedWorking.set(wt.slug, wt);
        taxonId = `tax-wt-${wt.slug}`;
      }
      identificationsOut.push({
        id: `studio-${idn.id}`,
        observation_id: `studio-${o.id}`,
        taxon_id: taxonId,
        display_identification: idn.display_identification,
        identified_by_profile_id: null,
        identified_by_text: idn.identified_by,
        identified_at: idn.identified_at,
        evidence: idn.evidence,
        remarks: idn.remarks,
        is_current: true,
      });
    }
  }

  // 静态站隐私管线（src/lib/privacy.ts）从 taxon_slug 解析权威类群；这里直接给出 slug 列
  const observationsOut = observations.map((o: any) => ({
    id: `studio-${o.id}`,
    public_id: o.public_id,
    place_id: o.place_id ? `place-${o.place_id}` : null,
    created_by: creatorProfile.get(o.created_by) ?? 'prof-zhiyong',
    observer: creatorProfile.get(o.created_by) ?? 'prof-zhiyong',
    observed_at: o.observed_at,
    observed_at_precision: o.observed_at_precision,
    location_id: `loc-studio-${o.id}`,
    sex: o.sex,
    life_stage: o.life_stage,
    count: o.count,
    habitat: o.habitat,
    microhabitat: o.microhabitat,
    behavior: o.behavior,
    plant: o.plant,
    weather: o.weather,
    field_note: o.field_note,
    status: o.status,
    visibility: o.visibility,
  }));

  const locationsOut = observations.map((o: any) => ({
    id: `loc-studio-${o.id}`,
    country_code: o.country_code ?? '',
    country_name: o.country_name ?? '',
    admin1: o.admin1 ?? '',
    admin2: o.admin2,
    locality: o.locality,
    site_name: o.site_name,
    latitude: o.exact_latitude,
    longitude: o.exact_longitude,
    elevation_m: o.elevation_m,
  }));

  const posts = await all<any>(env.DB, "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC");
  // 用户表（供 posts 作者名与 profiles 段共用）
  const users = await all<any>(
    env.DB,
    `SELECT u.id, u.email, u.display_name, p.title, p.bio, p.photo_media_id
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE u.email IS NOT NULL`,
  );
  const authorNameById = new Map<number, string>();
  for (const u of users) authorNameById.set(u.id, u.display_name);

  const postsOut = [];
  for (const p of posts) {
    const bodyMd = String(p.body_md ?? '');
    // 札记独立插图（不挂观察）：出现在已发布正文的 media: 引用也要随包导出，
    // observation_id 置 null（公开站 store 校验允许；仅服务札记正文，不出现在观察页）
    for (const ref of bodyMd.matchAll(/!\[[^\]]*\]\(media:([^)\s]+)\)/g)) {
      const pid = ref[1].trim();
      if (exportedMediaIds.has(pid)) continue;
      const m = await get<any>(env.DB, 'SELECT * FROM media WHERE public_id = ?', pid);
      if (!m) continue;
      mediaOut.push({
        id: m.public_id,
        public_id: m.public_id,
        observation_id: null,
        source_original: `media/originals/${m.public_id}${m.orig_ext}`,
        view_type: m.view_type,
        caption: m.caption,
        sort_order: 1,
        is_cover: false,
        photographer_profile_id: null,
        photographer_name: m.photographer_name,
        license: m.license,
        visibility: 'public',
      });
      exportedMediaIds.add(pid);
      const obj = await env.MEDIA.get(`originals/${m.public_id}${m.orig_ext}`);
      if (obj) originalFiles[`originals/${m.public_id}${m.orig_ext}`] = new Uint8Array(await obj.arrayBuffer());
    }
    // 封面：posts.cover_media_id → 媒体稳定编号（公开站 postCover 依赖此字段）
    const coverRow = p.cover_media_id
      ? await get<{ public_id: string }>(env.DB, 'SELECT public_id FROM media WHERE id = ?', p.cover_media_id)
      : undefined;
    postsOut.push({
      id: `studio-post-${p.id}`,
      slug: p.slug,
      title: p.title,
      subtitle: p.subtitle,
      template: p.template || 'classic',
      author_name: authorNameById.get(p.author_id) ?? '咩咩',
      created_at: p.created_at,
      published_at: p.published_at,
      cover_media_public_id: coverRow?.public_id ?? null,
      related_observation_public_ids: JSON.parse(String(p.related_observation_public_ids ?? '[]')) as string[],
      body_md: bodyMd,
      body_html: await renderBody(env, bodyMd),
    });
  }

  // 地点实体（§14/§19）：合并跳转关系一并导出
  const placesRows = await all<any>(
    env.DB,
    `SELECT id, name, country, admin1, admin2, locality, site_name, latitude, longitude, elevation_m, description, merged_into_id
     FROM places ORDER BY id`,
  );
  const placesJsonOut = placesRows.map((p: any) => ({
    id: `place-${p.id}`,
    name: p.name,
    country: p.country ?? '',
    admin1: p.admin1 ?? '',
    admin2: p.admin2 ?? '',
    locality: p.locality ?? '',
    site_name: p.site_name ?? '',
    latitude: p.latitude,
    longitude: p.longitude,
    elevation_m: p.elevation_m,
    description: p.description ?? null,
    merged_into_id: p.merged_into_id ? `place-${p.merged_into_id}` : null,
  }));

  // 伙伴公开资料（§26/§29）：每位有授权邮箱的账号导出稳定档案；代表照片随包入库
  const profilesOut: unknown[] = [];
  for (const u of users) {
    const email = String(u.email ?? '').toLowerCase();
    const profileId = EMAIL_PROFILE[email] ?? 'prof-u' + u.id;
    let photoPublicId: string | null = null;
    if (u.photo_media_id) {
      const m = await get<any>(env.DB, 'SELECT public_id, orig_ext FROM media WHERE id = ?', u.photo_media_id);
      if (m && !exportedMediaIds.has(m.public_id)) {
        photoPublicId = m.public_id;
        mediaOut.push({
          id: m.public_id,
          public_id: m.public_id,
          observation_id: null,
          source_original: `media/originals/${m.public_id}${m.orig_ext}`,
          view_type: 'live_portrait',
          caption: null,
          sort_order: 1,
          is_cover: false,
          photographer_profile_id: null,
          photographer_name: u.display_name,
          license: m.license ?? 'all_rights_reserved',
          visibility: 'public',
        });
        exportedMediaIds.add(m.public_id);
        const obj = await env.MEDIA.get(`originals/${m.public_id}${m.orig_ext}`);
        if (obj) originalFiles[`originals/${m.public_id}${m.orig_ext}`] = new Uint8Array(await obj.arrayBuffer());
      }
    }
    profilesOut.push({
      id: profileId,
      display_name: u.display_name,
      display_name_en: null,
      title: u.title ?? null,
      bio: u.bio ?? null,
      photo_media_public_id: photoPublicId,
    });
  }

  // 工作编号（§21-§24）：只导出被已发布鉴定实际引用的记录；parent_id 置空（不进入分类树，物种页照常聚合）
  const taxaOut = [...referencedWorking.values()].map((t) => ({
    id: `tax-wt-${t.slug}`,
    rank: t.rank,
    scientific_name: t.scientific_name,
    authorship: t.authorship,
    chinese_name: t.chinese_name,
    parent_id: null,
    status: 'working',
    slug: t.slug,
    personal_note: null,
  }));

  const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
  return {
    placesJson: j(placesJsonOut),
    taxaJson: j(taxaOut),
    profilesJson: j(profilesOut),
    observationsJson: j(observationsOut),
    locationsJson: j(locationsOut),
    mediaJson: j(mediaOut),
    identificationsJson: j(identificationsOut),
    postsJson: j(postsOut),
    originals: originalFiles,
  };
}

/** 打包为 zip 下载（手动导出备份用） */
export async function buildExportZip(env: Env): Promise<Uint8Array> {
  const data = await collectExport(env);
  const u8 = (s: string) => strToU8(s);
  return zipSync({
    'README.txt': strToU8(README),
    'studio-places.json': u8(data.placesJson),
    'studio-taxa.json': u8(data.taxaJson),
    'studio-profiles.json': u8(data.profilesJson),
    'studio-observations.json': u8(data.observationsJson),
    'studio-locations.json': u8(data.locationsJson),
    'studio-media.json': u8(data.mediaJson),
    'studio-identifications.json': u8(data.identificationsJson),
    'studio-posts.json': u8(data.postsJson),
    ...Object.fromEntries(Object.entries(data.originals).map(([k, v]) => [k, v])),
  });
}
