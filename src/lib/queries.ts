// 公开查询层：物种聚合、调查、地点、贡献者、媒体档案与搜索索引。
// 物种页面永远从「已发布观察 + 当前鉴定」推导，不手工维护物种条目（prompt.md §44）。

import {
  getPublicObservations,
  publicMediaFromRecord,
  toPublicObservation,
  withBase,
  type PublicMedia,
  type PublicObservation,
} from './privacy';
import {
  displayNameOf,
  media,
  mediaById,
  observations,
  placeById,
  posts,
  profiles,
  taxa,
  taxonBySlug,
  taxonById,
} from './store';
import type { Taxon, TaxonRank } from './types';
import { renderBodyMd, applyDuoLayout } from './markdown';
import { shortRegion } from './format';
import { noteTemplateOf } from './noteTemplates';

const publishedObservationIds = new Set(
  observations.filter((o) => o.status === 'published' && o.visibility === 'public').map((o) => o.id),
);

/** 已公开媒体的派生宽高（来自媒体清单），供灯箱/旅行插图的横竖比判断 */
export const MEDIA_DIMS = new Map<string, { width: number; height: number }>();
for (const o of getPublicObservations()) {
  for (const m of o.media) MEDIA_DIMS.set(m.id, { width: m.width, height: m.height });
}

export const allPublicObservations: PublicObservation[] = getPublicObservations().map((o) => {
  if (o.cover) {
    o.cover = o.media.find((m) => m.id === o.cover!.id) ?? o.cover;
  }
  return o;
});

export function getObservation(publicId: string): PublicObservation | undefined {
  const found = observations.find((o) => o.public_id === publicId);
  if (!found || found.status !== 'published' || found.visibility !== 'public') return undefined;
  const o = toPublicObservation(found);
  if (o.cover) o.cover = o.media.find((m) => m.id === o.cover!.id) ?? o.cover;
  return o;
}

// ---------- 物种聚合（按 taxon 聚合：cf. 等不同表述合并到同一物种页） ----------

export interface SpeciesGroup {
  key: string;
  /** 页面主显示名（由 taxon 推导） */
  display: string;
  rank: TaxonRank;
  taxon: Taxon;
  chinese_name: string | null;
  observations: PublicObservation[];
  /** 出现区域（shortRegion：国内为省，国外为国家 · 一级行政区） */
  regions: string[];
  personal_note: string | null;
  taxon_status: Taxon['status'] | null;
}

function taxonDisplayName(taxon: Taxon): string {
  if (taxon.rank === 'species' || taxon.rank === 'subspecies') return taxon.scientific_name;
  return `${taxon.scientific_name} sp.`;
}

export function getSpeciesGroups(): SpeciesGroup[] {
  const groups = new Map<string, SpeciesGroup>();
  for (const o of allPublicObservations) {
    const idn = o.identification;
    if (!idn) continue;
    const taxon = idn.taxon_slug ? findTaxonBySlug(idn.taxon_slug) : null;
    if (!taxon) continue;
    let g = groups.get(taxon.id);
    if (!g) {
      g = {
        key: taxon.id,
        display: taxonDisplayName(taxon),
        rank: taxon.rank,
        taxon,
        chinese_name: taxon.chinese_name ?? null,
        observations: [],
        regions: [],
        personal_note: taxon.personal_note ?? null,
        taxon_status: taxon.status,
      };
      groups.set(taxon.id, g);
    }
    g.observations.push(o);
    const r = shortRegion(o.location);
    if (!g.regions.includes(r)) g.regions.push(r);
  }
  for (const g of groups.values()) {
    g.observations.sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  }
  return [...groups.values()].sort((a, b) => b.observations.length - a.observations.length);
}

export function getSpeciesGroup(slug: string): SpeciesGroup | undefined {
  return getSpeciesGroups().find((g) => g.taxon.slug === slug);
}

export function speciesSlug(g: SpeciesGroup): string {
  return g.taxon.slug;
}

function findTaxonBySlug(slug: string): Taxon | null {
  return taxa.find((t) => t.slug === slug) ?? null;
}

/** 未鉴定（无当前鉴定）的已发布观察 */
export function getUnidentifiedObservations(): PublicObservation[] {
  return allPublicObservations.filter((o) => o.identification == null);
}

// ---------- 媒体档案：稳定编号 + 永久链接 ----------

export interface PublicMediaDetail {
  media: PublicMedia;
  observation: {
    public_id: string;
    url: string;
    observed_at: string;
    observed_at_precision: string;
    identification_display: string | null;
    identification_rank: TaxonRank | null;
    identification_slug: string | null;
    evidence: string | null;
    sex: string;
    life_stage: string;
    place_line: string;
    place_latitude: number | null;
    place_longitude: number | null;
    elevation_m: number | null;
  };
  photographer: string;
  license: string;
}

export function getPublicMediaDetail(publicMediaId: string): PublicMediaDetail | undefined {
  const record = media.find((m) => m.public_id === publicMediaId);
  if (!record || record.visibility !== 'public') return undefined;
  const obs = getObservationByRecord(record.observation_id);
  if (!obs) return undefined;
  const mediaDto = obs.media.find((m) => m.id === record.id);
  if (!mediaDto) return undefined;
  const loc = obs.location;
  return {
    media: mediaDto,
    observation: {
      public_id: obs.public_id,
      url: obs.url,
      observed_at: obs.observed_at,
      observed_at_precision: obs.observed_at_precision,
      identification_display: obs.identification?.display ?? null,
      identification_rank: obs.identification?.taxon_rank ?? null,
      identification_slug: obs.identification?.taxon_slug ?? null,
      evidence: obs.identification?.evidence ?? null,
      sex: obs.sex,
      life_stage: obs.life_stage,
      place_line: [loc.country_name, loc.admin1, loc.admin2, loc.locality].filter(Boolean).join(' · '),
      place_latitude: loc.latitude,
      place_longitude: loc.longitude,
      elevation_m: loc.elevation_m,
    },
    photographer: mediaDto.photographer,
    license: mediaDto.license,
  };
}

function getObservationByRecord(observationId: string | null): PublicObservation | undefined {
  // null = 札记独立插图（无观察归属），不进入观察相关展示
  if (observationId === null) return undefined;
  const found = observations.find((o) => o.id === observationId);
  if (!found || found.status !== 'published' || found.visibility !== 'public') return undefined;
  return getObservation(found.public_id);
}

/** 全站公开媒体索引（/media/ 档案页用，按编号排序） */
export function getAllPublicMedia(): { media: PublicMedia; observationPublicId: string; observationUrl: string; display: string | null }[] {
  const out: { media: PublicMedia; observationPublicId: string; observationUrl: string; display: string | null }[] = [];
  for (const record of [...media].sort((a, b) => a.public_id.localeCompare(b.public_id))) {
    if (record.visibility !== 'public') continue;
    const obs = getObservationByRecord(record.observation_id);
    if (!obs) continue;
    const dto = obs.media.find((m) => m.id === record.id);
    if (!dto) continue;
    out.push({
      media: dto,
      observationPublicId: obs.public_id,
      observationUrl: obs.url,
      display: obs.identification?.display ?? null,
    });
  }
  return out;
}

/** 某一组观察的全部公开媒体（物种页 PHOTOGRAPHIC RECORD 用） */
export function getMediaOfObservations(obs: PublicObservation[]): PublicMedia[] {
  return obs.flatMap((o) => o.media);
}

// ---------- 调查已并入野外笔记（posts）----------


// ---------- 地点（面向访客的地点视觉卡；观测 ID 留在详情页） ----------

export interface LocalityCard {
  country_code: string;
  country_name: string;
  admin1: string;
  name: string;
  elevation: number | null;
  count: number;
  habitats: string[];
  cover: { thumb: string; medium: string; large: string; view_type: string } | null;
  /** 代表坐标（首个有坐标的观察，WGS84）；地图模块用 */
  latitude: number | null;
  longitude: number | null;
  /** 对应的地点实体（存在时卡片链接到 /places/[id]/） */
  place_id: string | null;
}

/** 观察所属的地点实体（toPublicObservation 已解析合并跳转与位置记录标注） */
export function observationPlaceId(o: PublicObservation): string | null {
  return o.place_id;
}

/** 首页多栏目同源防重复：同一观察按角度偏移取照（代表图为 0 号位，循环取）。
 *  例：offset=1 时物种卡显示第 2 角度，避免与「最近的相遇」同图。 */
export function observationCoverAt(o: PublicObservation, offset: number): PublicMedia | null {
  const media = o.media ?? [];
  const cover = o.cover;
  if (!media.length || !cover) return cover ?? media[0] ?? null;
  const ci = media.findIndex((m) => m.id === cover.id);
  if (ci < 0 || media.length === 1) return cover;
  const shift = ((offset % media.length) + media.length) % media.length;
  return media[(ci + shift) % media.length] ?? cover;
}

/** 鉴定类群 slug → 物种中文名（无中文名或未知类群返回 null），供各页面在学名旁展示 */
export function chineseNameOfSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return taxonBySlug.get(slug)?.chinese_name ?? null;
}

export function getLocalityCards(): LocalityCard[] {
  const byLocality = new Map<string, LocalityCard>();
  for (const o of allPublicObservations) {
    const loc = o.location;
    const nameParts = [loc.admin2, loc.locality ?? loc.site_name].filter(Boolean) as string[];
    const key = `${loc.country_code}|${loc.admin1}|${nameParts.join('·')}`;
    let card = byLocality.get(key);
    if (!card) {
      card = {
        country_code: loc.country_code,
        country_name: loc.country_name,
        admin1: loc.admin1,
        name: nameParts.join(' · ') || loc.admin1,
        elevation: loc.elevation_m,
        count: 0,
        habitats: [],
        cover: null,
        latitude: loc.latitude,
        longitude: loc.longitude,
        place_id: null,
      };
      byLocality.set(key, card);
    }
    card.count += 1;
    const pid = observationPlaceId(o);
    if (pid && !card.place_id) card.place_id = pid;
    if (o.habitat && !card.habitats.includes(o.habitat)) card.habitats.push(o.habitat);
    // 封面层级（§110 修订）：遍历观察全部照片（生境照常非代表图），生境 > 行为 > 其他；
    // 「其他」层级避开封面位——该观察有多角度时，地点卡不再与「最近的相遇」同图
    const rank = (v: string) => (v === 'habitat' ? 2 : v === 'behavior' ? 1 : 0);
    const ranked = o.media
      .filter((m) => m && m.view_type)
      .map((m, i) => ({ m, i, r: rank(m.view_type) }))
      .sort((a, b) => b.r - a.r || a.i - b.i);
    let best = ranked[0];
    if (best && best.r === 0 && best.i === 0 && o.media.length > 1) {
      best = ranked.find((r2) => r2.i !== 0) ?? best;
    }
    if (best && (!card.cover || rank(best.m.view_type) > rank(card.cover.view_type))) {
      card.cover = { thumb: best.m.thumb, medium: best.m.medium, large: best.m.large, view_type: best.m.view_type };
    }
  }
  return [...byLocality.values()].sort((a, b) => b.count - a.count);
}

// ---------- 地点实体页面（§14/§19）：以地点为主体聚合观察、物种与札记 ----------

export interface PublicPlace {
  id: string;
  name: string;
  url: string;
  country: string;
  admin1: string;
  admin2: string;
  locality: string;
  site_name: string;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  description: string | null;
}

function publicPlace(id: string): PublicPlace | undefined {
  const p = placeById.get(id);
  if (!p || p.merged_into_id) return undefined;
  return {
    id: p.id,
    name: p.name,
    url: withBase(`/places/${p.id}/`),
    country: p.country,
    admin1: p.admin1,
    admin2: p.admin2,
    locality: p.locality,
    site_name: p.site_name,
    latitude: p.latitude,
    longitude: p.longitude,
    elevation_m: p.elevation_m,
    description: p.description,
  };
}

/** merged 地点的跳转目标 URL（供 getStaticPaths 生成重定向页） */
export function getPlaceRedirect(id: string): string | null {
  const p = placeById.get(id);
  if (!p?.merged_into_id) return null;
  return publicPlace(p.merged_into_id)?.url ?? null;
}

/** 全部公开地点（按观察数排序），供地点索引页与静态路径生成 */
export function getPublicPlaces(): (PublicPlace & { count: number; cover: PublicObservation['cover'] })[] {
  const counts = new Map<string, number>();
  for (const o of allPublicObservations) {
    const pid = observationPlaceId(o);
    if (!pid) continue;
    counts.set(pid, (counts.get(pid) ?? 0) + 1);
  }
  return [...counts.keys()]
    .map((id) => {
      const place = publicPlace(id);
      if (!place) return null;
      const atPlace = allPublicObservations.filter((o) => observationPlaceId(o) === id);
      const cover = atPlace.find((o) => o.cover)?.cover ?? null;
      return { ...place, count: counts.get(id) ?? 0, cover };
    })
    .filter((p): p is PublicPlace & { count: number; cover: PublicObservation['cover'] } => p != null)
    .sort((a, b) => b.count - a.count);
}

export interface PlacePageData {
  place: PublicPlace;
  observations: PublicObservation[];
  /** 在此记录过的物种（按观察数排序，链接到物种页；带代表照） */
  species: { display: string; rank: TaxonRank | null; slug: string | null; count: number; cover: PublicMedia | null }[];
  /** 相关札记：文中观察落在该地点 */
  posts: { title: string; url: string }[];
  /** 生境 Hero：优先生境类型照片，其次横构图照片 */
  heroPhoto: PublicMedia | null;
  /** 生境影像组（横构图优先，用于「生境影像」一节） */
  habitatPhotos: PublicMedia[];
  /** 该地点出现过的生境描述（「关于这个地方」的素材） */
  habitats: string[];
}

export function getPlacePage(id: string): PlacePageData | undefined {
  const place = publicPlace(id);
  if (!place) return undefined;
  const observations = allPublicObservations
    .filter((o) => observationPlaceId(o) === id)
    .sort((a, b) => b.observed_at.localeCompare(a.observed_at));
  const speciesMap = new Map<string, { display: string; rank: TaxonRank | null; slug: string | null; count: number; cover: PublicMedia | null }>();
  const habitats: string[] = [];
  const allPhotos: PublicMedia[] = [];
  for (const o of observations) {
    const idn = o.identification;
    if (idn) {
      const key = idn.taxon_slug ?? idn.display;
      const e = speciesMap.get(key);
      if (e) e.count += 1;
      else speciesMap.set(key, { display: idn.display, rank: idn.taxon_rank, slug: idn.taxon_slug, count: 1, cover: null });
    }
    if (o.habitat && !habitats.includes(o.habitat)) habitats.push(o.habitat);
    for (const m of o.media) {
      allPhotos.push(m);
      if (idn) {
        const e = speciesMap.get(idn.taxon_slug ?? idn.display)!;
        // 物种代表照：跳过生境照，优先有主体的照片
        if (!e.cover && m.view_type !== 'habitat') e.cover = m;
      }
    }
  }
  // §110（修订）：生境照优先，行为照次之；都没有时用该地点现有的照片兜底，不再留占位
  const habitatTyped = allPhotos.filter((m) => m.view_type === 'habitat');
  const behaviorTyped = allPhotos.filter((m) => m.view_type === 'behavior' && m.width > m.height);
  const heroPhoto = habitatTyped[0] ?? behaviorTyped[0] ?? allPhotos[0] ?? null;
  const habitatPhotos = habitatTyped.slice(0, 4);
  const obsIds = new Set(observations.map((o) => o.public_id));
  const posts = getPublishedPosts()
    .filter((p) => p.relatedObservations.some((ro) => obsIds.has(ro.public_id)))
    .map((p) => ({ title: p.title, url: withBase(`/posts/${p.slug}/`) }));
  return {
    place,
    observations,
    species: [...speciesMap.values()].sort((a, b) => b.count - a.count),
    posts,
    heroPhoto,
    habitatPhotos,
    habitats,
  };
}

/** 札记关联区块（§札记）：从文中观察自动推导相关物种与地点 */
export function getPostLinks(
  post: PublicPost,
): {
  species: { display: string; rank: TaxonRank | null; slug: string | null; url: string | null }[];
  places: { name: string; url: string }[];
} {
  const speciesMap = new Map<string, { display: string; rank: TaxonRank | null; slug: string | null; url: string | null }>();
  const placeMap = new Map<string, { name: string; url: string }>();
  for (const ro of post.relatedObservations) {
    const o = getObservation(ro.public_id);
    if (!o) continue;
    if (o.identification) {
      const key = o.identification.taxon_slug ?? o.identification.display;
      if (!speciesMap.has(key)) {
        speciesMap.set(key, {
          display: o.identification.display,
          rank: o.identification.taxon_rank,
          slug: o.identification.taxon_slug,
          url: o.identification.taxon_slug ? withBase(`/species/${o.identification.taxon_slug}/`) : null,
        });
      }
    }
    const pid = observationPlaceId(o);
    if (pid && !placeMap.has(pid)) {
      const p = publicPlace(pid);
      if (p) placeMap.set(pid, { name: p.name, url: p.url });
    }
  }
  return { species: [...speciesMap.values()], places: [...placeMap.values()] };
}

// ---------- 贡献者（仅公开主页，人文化呈现） ----------

export interface PublicContributor {
  name: string;
  nameEn: string | null;
  slug: string;
  title: string | null;
  bio: string | null;
  /** 伙伴自助上传的代表照片（Studio 个人资料同步；可空） */
  photo: { thumb: string; medium: string; large: string } | null;
  observationCount: number;
  regions: string[];
  favorite: { thumb: string; medium: string; large: string } | null;
  coverThumbs: { thumb: string; url: string; alt: string }[];
  /** 展示顺序（跟随 profiles.json 定义） */
  order: number;
}

export function getPublicContributors(): PublicContributor[] {
  // 顺序按 profiles.json 的定义（咩咩 → 哈姆 → 义 → 涛 …），不按观察数
  return profiles
    .filter((p) => p.profile_visibility === 'public' && p.slug != null)
    .map((p, idx) => {
      const own = allPublicObservations.filter(
        (o) => o.observer_name === p.display_name || o.identification?.identified_by === p.display_name,
      );
      const observedBy = allPublicObservations.filter((o) => o.observer_name === p.display_name);
      const regions: string[] = [];
      for (const o of observedBy) {
        const r = shortRegion(o.location);
        if (!regions.includes(r)) regions.push(r);
      }
      const photoMedia =
        'photo_media_public_id' in p && p.photo_media_public_id
          ? media.find((m) => m.public_id === p.photo_media_public_id && m.visibility === 'public')
          : undefined;
      const photo = photoMedia ? publicMediaFromRecord(photoMedia) : null;
      const favoriteMedia = p.favorite_media_id ? mediaById.get(p.favorite_media_id) : undefined;
      const favorite =
        favoriteMedia &&
        favoriteMedia.visibility === 'public' &&
        favoriteMedia.observation_id !== null &&
        publishedObservationIds.has(favoriteMedia.observation_id)
          ? publicMediaFromRecord(favoriteMedia)
          : null;
      const coverThumbs = observedBy
        .filter((o) => o.cover)
        .slice(0, 6)
        .map((o) => ({
          thumb: o.cover!.thumb,
          url: o.url,
          alt: `${o.public_id} 封面照片`,
        }));
      return {
        name: p.display_name,
        nameEn: p.display_name_en,
        slug: p.slug!,
        title: p.title,
        bio: p.bio,
        photo,
        observationCount: own.length,
        regions,
        favorite,
        coverThumbs,
        order: idx,
      };
    })
    .sort((a, b) => a.order - b.order);
}

export function getPublicContributor(slug: string): PublicContributor | undefined {
  return getPublicContributors().find((c) => c.slug === slug);
}

// ---------- 分类浏览（二级导航；只含本站实际出现的类群） ----------

export interface TaxonNode {
  taxon: Taxon;
  /** 含子级的相遇数 */
  count: number;
  /** 直接以该阶元为当前鉴定的观察数 */
  ownCount: number;
  slug: string | null;
  children: TaxonNode[];
}

export function getTaxonomyBrowse(): TaxonNode | null {
  const root = taxa.find((t) => t.rank === 'family');
  if (!root) return null;

  const directCounts = new Map<string, number>();
  for (const o of allPublicObservations) {
    const slug = o.identification?.taxon_slug;
    if (!slug) continue;
    const taxon = findTaxonBySlug(slug);
    if (!taxon) continue;
    directCounts.set(taxon.id, (directCounts.get(taxon.id) ?? 0) + 1);
  }

  function buildNode(taxon: Taxon): TaxonNode | null {
    const children = taxa
      .filter((t) => t.parent_id === taxon.id)
      .map(buildNode)
      .filter((n): n is TaxonNode => n != null)
      .sort((a, b) => b.count - a.count || a.taxon.scientific_name.localeCompare(b.taxon.scientific_name));
    const ownCount = directCounts.get(taxon.id) ?? 0;
    const count = ownCount + children.reduce((n, c) => n + c.count, 0);
    if (count === 0) return null;
    return {
      taxon,
      count,
      ownCount,
      slug: taxon.slug,
      children,
    };
  }

  return buildNode(root);
}

// ---------- 观察博文 ----------

export interface PublicPost {
  slug: string;
  title: string;
  subtitle: string | null;
  author: string;
  created_at: string;
  cover: { thumb: string; medium: string; large: string } | null;
  relatedObservations: { public_id: string; url: string; display: string | null }[];
  bodyHtml: string;
  /** 野外笔记元信息（由调查合并而来的篇目携带） */
  region?: string | null;
  dateRange?: string | null;
  /** 版式模板 id（noteTemplates 白名单，未知值按 classic） */
  template: string;
}

function postCover(mediaPublicId: string | null) {
  if (!mediaPublicId) return null;
  const record = media.find((m) => m.public_id === mediaPublicId && m.visibility === 'public');
  if (!record || record.observation_id === null || !publishedObservationIds.has(record.observation_id)) return null;
  return publicMediaFromRecord(record);
}

export function getPublishedPosts(): PublicPost[] {
  return posts
    .map((p) => {
      const hand = p as typeof p & { region?: string | null; date_range?: string | null; body_md?: string };
      return {
        slug: p.slug,
        title: p.title,
        subtitle: p.subtitle ?? null,
        author: p.author_name,
        created_at: p.created_at,
        cover: postCover(p.cover_media_public_id),
        relatedObservations: p.related_observation_public_ids
          .map((pid) => {
            const o = getObservation(pid);
            return o ? { public_id: o.public_id, url: o.url, display: o.identification?.display ?? null } : null;
          })
          .filter((x): x is NonNullable<typeof x> => x != null),
        bodyHtml: applyDuoLayout(
          p.body_html ??
            renderBodyMd(hand.body_md ?? '', (pid) => {
              const rec = media.find((m) => m.public_id === pid && m.visibility === 'public');
              return rec ? publicMediaFromRecord(rec) : null;
            }),
        ),
        region: hand.region ?? null,
        dateRange: hand.date_range ?? null,
        template: noteTemplateOf(p.template),
      };
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getPublishedPost(slug: string): PublicPost | undefined {
  return getPublishedPosts().find((p) => p.slug === slug);
}

// ---------- 搜索索引（只含公开安全字段） ----------

export function buildSearchIndex() {
  const obs = allPublicObservations.map((o) => ({
    type: 'observation',
    id: o.public_id,
    url: o.url,
    title: o.identification?.display ?? '未鉴定的跳蛛',
    meta: `${o.observed_at} · ${shortRegion(o.location)}`,
    // §108 统一搜索：学名/地点/国家/伙伴/调查/年份/生境 都要能命中
    text: [
      o.location.country_name, o.location.admin1, o.location.admin2,
      o.location.locality, o.location.site_name,
      o.habitat, o.microhabitat, o.behavior, o.field_note,
      o.observer_name,
      o.identification?.identified_by ?? '',
    ]
      .filter(Boolean)
      .join(' '),
    thumb: o.cover?.thumb ?? null,
  }));
  const species = getSpeciesGroups().map((g) => ({
    type: 'species',
    id: speciesSlug(g),
    url: withBase(`/species/${speciesSlug(g)}/`),
    title: g.display,
    meta: `${g.observations.length} 次相遇 · ${g.regions.join('、')}`,
    text: [g.chinese_name ?? '', g.personal_note ?? ''].join(' '),
    thumb: g.observations.find((o) => o.cover)?.cover?.thumb ?? null,
  }));
  const postIndex = getPublishedPosts().map((p) => ({
    type: 'post',
    id: p.slug,
    url: withBase(`/posts/${p.slug}/`),
    title: p.title,
    meta: `${p.created_at.slice(0, 10)} · ${p.author}`,
    text: p.bodyHtml.replace(/<[^>]+>/g, ' ').slice(0, 400),
    thumb: p.cover?.thumb ?? null,
  }));
  return { observations: obs, species, posts: postIndex };
}
