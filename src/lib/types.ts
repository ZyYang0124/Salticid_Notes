// 数据模型类型 — 与 prompt.md §9–§21 的核心数据模型对应。
// 静态部署形态下，数据库规范落实为：类型化 JSON 源数据 + 构建期校验 + 隐私过滤管线。

export type ObservationStatus =
  | 'draft'
  | 'submitted'
  | 'review'
  | 'revision_requested'
  | 'approved'
  | 'published'
  | 'rejected'
  | 'archived';

export type Visibility = 'public' | 'private' | 'embargoed';

export type Sex = 'male' | 'female' | 'unknown' | 'mixed' | 'not_applicable';

export type LifeStage = 'adult' | 'subadult' | 'juvenile' | 'unknown' | 'mixed';

export type Evidence =
  | 'field'
  | 'tentative'
  | 'photo_based'
  | 'specimen_examined'
  | 'genitalia_confirmed'
  | 'molecularly_supported';

export type MediaViewType =
  | 'live_dorsal'
  | 'live_frontal'
  | 'live_lateral'
  | 'behavior'
  | 'habitat'
  | 'specimen_dorsal'
  | 'specimen_ventral'
  | 'male_palp'
  | 'epigyne'
  | 'vulva'
  | 'microscopy'
  | 'other';

export type License = 'all_rights_reserved' | 'cc_by_4_0' | 'cc_by_nc_4_0';

export type DatePrecision = 'day' | 'month' | 'year' | 'unknown';

export type TaxonRank = 'family' | 'tribe' | 'genus' | 'species' | 'subspecies';

/** working：Studio 建立的工作编号（cf./aff./sp. 等未定名类群），与 D1 working_taxa 的 status 对齐 */
export type TaxonStatus = 'accepted' | 'synonym' | 'provisional' | 'unresolved' | 'working';

export interface Profile {
  id: string;
  /** Studio 自助资料同步的代表照片（可空） */
  photo_media_public_id?: string | null;
  display_name: string;
  display_name_en: string | null;
  slug: string | null;
  role: 'owner' | 'editor' | 'contributor';
  profile_visibility: 'public' | 'private';
  /** 公开页展示的人文身份描述（非权限角色） */
  title: string | null;
  bio: string | null;
  /** 用于个人页封面的代表性照片 */
  favorite_media_id: string | null;
}

export interface Taxon {
  id: string;
  rank: TaxonRank;
  scientific_name: string;
  authorship: string | null;
  chinese_name: string | null;
  parent_id: string | null;
  status: TaxonStatus;
  slug: string;
  personal_note: string | null;
}

/** 地点记录：单一坐标模型。跳蛛观察坐标全量精确公开（Studio SOP §7），无模糊化层级。 */
export interface LocationRecord {
  id: string;
  /** ISO 3166-1 alpha-2，如 CN / MY；地理模型全球适用（SOP §47） */
  country_code: string;
  country_name: string;
  /** 一级行政区（省/州/邦/大区…） */
  admin1: string;
  /** 二级行政区（县/市/省辖…，可空） */
  admin2: string | null;
  /** 地方描述 */
  locality: string | null;
  /** 具体地点名（可空） */
  site_name: string | null;
  /** 十进制纬度（WGS84）；观察记录坐标全量公开 */
  latitude: number | null;
  /** 十进制经度（WGS84） */
  longitude: number | null;
  elevation_m: number | null;
  /** 挂接的地点实体（Place，§14）；手写数据按同名地点标注 */
  place_id?: string | null;
}

/** 地点实体（§14/§19）：Field Studio 维护，经 studio-places.json 同步；merged_into_id 为合并跳转 */
export interface PlaceRecord {
  id: string;
  name: string;
  country: string;
  admin1: string;
  admin2: string;
  locality: string;
  site_name: string;
  latitude: number | null;
  longitude: number | null;
  elevation_m: number | null;
  description: string | null;
  merged_into_id: string | null;
}

export interface Observation {
  id: string;
  public_id: string;
  created_by: string;
  observer: string;
  observed_at: string;
  observed_at_precision: DatePrecision;
  location_id: string;
  sex: Sex;
  life_stage: LifeStage;
  habitat: string | null;
  microhabitat: string | null;
  behavior: string | null;
  field_note: string;
  status: ObservationStatus;
  visibility: Visibility;
  /** 历史遗留列（调查已并入野外笔记；关联关系由笔记的 related 列表反查） */
  trip_id?: string | null;
  /** 首次发布时间（Studio 导出；手写数据可为空，回退 observed_at 排序） */
  published_at?: string | null;
  /** 挂接的地点实体（Place，§14）；Studio 记录导出时写入 */
  place_id?: string | null;
}

/** 鉴定独立成表：观察记录中绝不存储权威学名（DEVELOPMENT.md 规则 5/6/7）。 */
export interface Identification {
  id: string;
  observation_id: string;
  taxon_id: string;
  display_identification: string;
  identified_by_profile_id: string | null;
  /** 无账号的鉴定人姓名（如外部专家） */
  identified_by_text?: string | null;
  identified_at: string;
  evidence: Evidence;
  remarks: string | null;
  is_current: boolean;
}

export interface MediaRecord {
  id: string;
  /** 稳定公开编号 SN-YYYY-NNNNN，一经分配永不变、不含学名/文件名/地名 */
  public_id: string;
  /** 札记独立插图不挂观察（Studio 导出 observation_id: null），仅服务札记正文 */
  observation_id: string | null;
  source_original: string;
  view_type: MediaViewType;
  caption: string | null;
  sort_order: number;
  is_cover: boolean;
  photographer_profile_id: string | null;
  photographer_name: string | null;
  license: License;
  visibility: Visibility;
}

export interface Specimen {
  id: string;
  observation_id: string;
  collector: string;
  catalog_number: string;
  field_number: string | null;
  repository: string;
  preservation: string | null;
  sex: Sex;
  life_stage: LifeStage;
  notes: string | null;
}

export interface SiteConfig {
  site_name: string;
  subtitle: string;
  subtitle_en: string;
  owner_profile_id: string;
  public_id_prefix: string;
  copyright_holder: string;
  disclaimer: string;
  demo_note: string;
  footer_note: string;
}

/** 观察博文（Field Studio 撰写、审核发布后导出；body_html 已在导出时消毒） */
export interface Post {
  id: string;
  slug: string;
  title: string;
  subtitle?: string | null;
  author_name: string;
  published_at?: string | null;
  created_at: string;
  cover_media_public_id: string | null;
  related_observation_public_ids: string[];
  body_md: string;
  body_html: string;
  /** 版式模板 id（noteTemplates.ts 白名单，未知值按 classic 呈现） */
  template?: string;
}
