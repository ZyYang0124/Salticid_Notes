// 数据装载与完整性校验。
// 构建期执行（任何违规直接让 build 失败），等价于数据库层的外键约束与状态机约束。

import type {
  Identification,
  LocationRecord,
  MediaRecord,
  Observation,
  PlaceRecord,
  Post,
  Profile,
  SiteConfig,
  Specimen,
  Taxon,
} from './types';

// 数据以 Vite 静态导入内联进构建产物；这里的 JSON 即「数据库」的源表。
// studio-*.json 由 Field Studio 后端导出（见 studio/src/export.ts），与手写数据合并、不覆盖。
import siteConfigJson from '../data/site.config.json';
import profilesJson from '../data/profiles.json';
import taxaJson from '../data/taxa.json';
import locationsJson from '../data/locations.json';
import observationsJson from '../data/observations.json';
import identificationsJson from '../data/identifications.json';
import mediaJson from '../data/media.json';
import postsJson from '../data/posts.json';
import specimensJson from '../data/specimens.json';

const studioModules = import.meta.glob('../data/studio-*.json', { eager: true });
function loadStudio<T>(name: string): T[] {
  const mod = studioModules[`../data/studio-${name}.json`] as { default: T } | undefined;
  return (mod?.default ?? []) as T[];
}

export const siteConfig = siteConfigJson as unknown as SiteConfig;
export const profiles = profilesJson as unknown as Profile[];

// Studio 自助资料（studio-profiles.json，发布管线自动同步）按 id 覆盖手写档案；新档案追加
for (const sp of loadStudio<Partial<Profile> & { id: string }>('profiles')) {
  const base = profiles.find((p) => p.id === sp.id);
  if (base) {
    base.display_name = sp.display_name ?? base.display_name;
    base.title = sp.title ?? base.title;
    base.bio = sp.bio ?? base.bio;
    base.photo_media_public_id = sp.photo_media_public_id ?? null;
  } else {
    profiles.push({
      id: sp.id,
      display_name: sp.display_name ?? sp.id,
      display_name_en: null,
      slug: null,
      role: 'contributor',
      profile_visibility: 'public',
      title: sp.title ?? null,
      bio: sp.bio ?? null,
      favorite_media_id: null,
      photo_media_public_id: sp.photo_media_public_id ?? null,
    } as Profile);
  }
}
// Studio 工作编号（§21-§24，studio-taxa.json）：cf./aff./sp. 等合法鉴定目标，追加到静态类群表
export const taxa = [
  ...(taxaJson as unknown as Taxon[]),
  ...loadStudio<Taxon>('taxa'),
];
export const places = loadStudio<PlaceRecord>('places');
export const locations = [
  ...(locationsJson as unknown as LocationRecord[]),
  ...loadStudio<LocationRecord>('locations'),
];
export const observations = [
  ...(observationsJson as unknown as Observation[]),
  ...loadStudio<Observation>('observations'),
];
export const identifications = [
  ...(identificationsJson as unknown as Identification[]),
  ...loadStudio<Identification>('identifications'),
];
export const media = [...(mediaJson as unknown as MediaRecord[]), ...loadStudio<MediaRecord>('media')];
export const specimens = specimensJson as unknown as Specimen[];
// 野外笔记 = 手写文章（含由调查合并而来的篇目）+ Studio 发布的文章；同 slug 时 Studio 为真源
const handPosts = (postsJson as unknown as (Post & { region?: string | null; date_range?: string | null })[]);
const studioPosts = loadStudio<Post>('posts');
export const posts = [
  ...handPosts.filter((p) => !studioPosts.some((sp) => sp.slug === p.slug)),
  ...studioPosts,
];

// ---------- 校验（dev/构建期 "migration gate"） ----------

function fail(msg: string): never {
  throw new Error(`[数据校验失败] ${msg}`);
}

function validate(): void {
  const profileIds = new Set(profiles.map((p) => p.id));
  const taxonIds = new Set(taxa.map((t) => t.id));
  const locationIds = new Set(locations.map((l) => l.id));
  const observationIds = new Set(observations.map((o) => o.id));
  const mediaIds = new Set(media.map((m) => m.id));
  const mediaPublicIds = new Set<string>();
  const placeIds = new Set(places.map((p) => p.id));
  const publicIds = new Set<string>();

  for (const t of taxa) {
    if (t.parent_id && !taxonIds.has(t.parent_id)) fail(`taxon ${t.id} 的 parent_id 不存在`);
  }

  for (const o of observations) {
    if (publicIds.has(o.public_id)) fail(`public_id 重复：${o.public_id}`);
    if (!/^SFN-\d{4}-\d{6}$/.test(o.public_id)) fail(`public_id 格式非法：${o.public_id}（不得包含学名/地名/人名）`);
    publicIds.add(o.public_id);
    if (!observationIds.has(o.id)) fail(`观察 ${o.public_id} 自引用异常`);
    if (!profileIds.has(o.observer)) fail(`观察 ${o.public_id} 的 observer 不存在`);
    if (!locationIds.has(o.location_id)) fail(`观察 ${o.public_id} 的 location_id 不存在`);
  }

  // 规则 6/7：每条鉴定必须引用 taxon 记录；每条观察至多一条当前鉴定
  const currentPerObservation = new Map<string, number>();
  for (const idn of identifications) {
    if (!observationIds.has(idn.observation_id)) fail(`鉴定 ${idn.id} 指向不存在的观察`);
    if (!taxonIds.has(idn.taxon_id)) fail(`鉴定 ${idn.id} 未引用 taxon 记录（规则 6）`);
    if (idn.is_current) {
      currentPerObservation.set(idn.observation_id, (currentPerObservation.get(idn.observation_id) ?? 0) + 1);
    }
  }
  for (const [obsId, n] of currentPerObservation) {
    if (n > 1) fail(`观察 ${obsId} 存在 ${n} 条当前鉴定（is_current 必须唯一）`);
  }

  for (const m of media) {
    // observation_id 为 null 仅限札记独立插图（Studio 导出；只服务札记正文，不挂观察）
    if (m.observation_id !== null && !observationIds.has(m.observation_id)) fail(`媒体 ${m.id} 指向不存在的观察`);
    if (!/^SN-\d{4}-\d{5}$/.test(m.public_id)) fail(`媒体 ${m.id} 的 public_id 格式非法：${m.public_id}（照片编号 SN-年份-流水，5 位）`);
    if (mediaPublicIds.has(m.public_id)) fail(`媒体 public_id 重复：${m.public_id}`);
    mediaPublicIds.add(m.public_id);
    if (m.photographer_profile_id && !profileIds.has(m.photographer_profile_id)) {
      fail(`媒体 ${m.id} 的 photographer 不存在`);
    }
  }
  for (const s of specimens) {
    if (!observationIds.has(s.observation_id)) fail(`标本 ${s.id} 指向不存在的观察`);
  }

  // 地点数据完整性：单一坐标模型，有地名层级即可，坐标可为空（待补），
  // 但一旦提供必须落在合法范围（观察坐标全量精确公开，Studio SOP §7）。
  for (const l of locations) {
    if (l.place_id && !placeIds.has(l.place_id)) fail(`地点记录 ${l.id} 的 place_id 不存在：${l.place_id}`);
    for (const [k, v] of [['latitude', l.latitude], ['longitude', l.longitude]] as const) {
      if (v == null) continue;
      const ok = k === 'latitude' ? v >= -90 && v <= 90 : v >= -180 && v <= 180;
      if (!ok) fail(`地点 ${l.id} 的 ${k} 超出合法范围：${v}`);
    }
  }

  // 地点实体（§14）：合并跳转必须指向存在的地点，且观察挂接的地点必须存在
  const resolvedPlaceIds = new Set<string>();
  for (const p of places) {
    if (p.merged_into_id) {
      if (!placeIds.has(p.merged_into_id)) fail(`地点 ${p.id} 的 merged_into_id 不存在：${p.merged_into_id}`);
    } else {
      resolvedPlaceIds.add(p.id);
    }
  }
  for (const o of observations) {
    if (o.place_id && !resolvedPlaceIds.has(o.place_id)) {
      fail(`观察 ${o.public_id} 的 place_id 不存在或已被合并：${o.place_id}`);
    }
  }
}
validate();

// ---------- 索引 ----------

export const profileById = new Map(profiles.map((p) => [p.id, p]));
export const taxonById = new Map(taxa.map((t) => [t.id, t]));
export const taxonBySlug = new Map(taxa.filter((t) => t.slug).map((t) => [t.slug, t]));
export const locationById = new Map(locations.map((l) => [l.id, l]));
export const observationById = new Map(observations.map((o) => [o.id, o]));
export const mediaByObservation = new Map<string, MediaRecord[]>();
for (const m of media) {
  if (m.observation_id === null) continue; // 札记插图无观察归属
  const list = mediaByObservation.get(m.observation_id) ?? [];
  list.push(m);
  mediaByObservation.set(m.observation_id, list);
}
for (const list of mediaByObservation.values()) {
  list.sort((a, b) => a.sort_order - b.sort_order);
}
export const mediaById = new Map(media.map((m) => [m.id, m]));
export const placeById = new Map(places.map((p) => [p.id, p]));
/** 合并跳转：merged 地点 id → 保留地点 id（多级合并一次解析） */
export const placeMergedInto = new Map<string, string>();
for (const p of places) {
  if (!p.merged_into_id) continue;
  let target = p.merged_into_id;
  for (let i = 0; i < 8; i++) {
    const next = places.find((q) => q.id === target)?.merged_into_id;
    if (!next) break;
    target = next;
  }
  placeMergedInto.set(p.id, target);
}
export const specimenByObservation = new Map(specimens.map((s) => [s.observation_id, s]));
export const currentIdentificationByObservation = new Map<string, Identification>();
for (const idn of identifications) {
  if (idn.is_current) currentIdentificationByObservation.set(idn.observation_id, idn);
}
export const identificationsByObservation = new Map<string, Identification[]>();
for (const idn of identifications) {
  const list = identificationsByObservation.get(idn.observation_id) ?? [];
  list.push(idn);
  identificationsByObservation.set(idn.observation_id, list);
}
for (const list of identificationsByObservation.values()) {
  list.sort((a, b) => a.identified_at.localeCompare(b.identified_at));
}

export function displayNameOf(profileId: string | null): string | null {
  if (!profileId) return null;
  return profileById.get(profileId)?.display_name ?? null;
}
