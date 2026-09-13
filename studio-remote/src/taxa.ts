// 工作编号（§21-§24）：cf. / aff. / sp. / 属级 sp. 等未定名类群。
// 静态 taxa-data.json 是正式类群；这里补充 D1 中的工作编号，二者合成鉴定可选列表。
import taxaData from './taxa-data.json';
import { all, get, run, type Env } from './db';

/** 编辑器物种选择器选项（与 pages.ts boot.taxa 形状一致） */
export interface TaxonOption {
  slug: string;
  name: string;
  cn: string | null;
  rank: string;
  /** true = 工作编号（非正式发表类群） */
  working?: boolean;
}

const STATIC_TAXA = taxaData as { slug: string; scientific_name: string; chinese_name: string | null; rank: string }[];

const staticSlugs = new Set(STATIC_TAXA.map((t) => t.slug));

/** 学名/工作编号形态：字母开头，可含空格、连字符与 cf. / aff. / sp. / gen. nov. 等限定词 */
const NAME_RE = /^[A-Za-z][A-Za-z.\- ]{1,79}$/;

export function slugifyTaxonName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export interface WorkingTaxonRow {
  id: number;
  slug: string;
  scientific_name: string;
  rank: string;
  authorship: string | null;
  chinese_name: string | null;
  status: string;
  created_by: string | null;
  created_at: string;
}

export async function workingTaxaRows(env: Env): Promise<WorkingTaxonRow[]> {
  return all<WorkingTaxonRow>(env.DB, 'SELECT * FROM working_taxa ORDER BY created_at, id');
}

/** 静态正式类群 + D1 工作编号，合成编辑器完整可选列表（不含已合并的） */
export async function allTaxonOptions(env: Env): Promise<TaxonOption[]> {
  const staticOptions: TaxonOption[] = STATIC_TAXA.map((t) => ({
    slug: t.slug,
    name: t.scientific_name,
    cn: t.chinese_name,
    rank: t.rank,
  }));
  const working = (await workingTaxaRows(env))
    .filter((t) => t.status !== 'merged')
    .map((t) => ({
      slug: t.slug,
      name: t.scientific_name,
      cn: t.chinese_name,
      rank: t.rank,
      working: true,
    }));
  return [...staticOptions, ...working];
}

/** 鉴定写入用：slug → 类群（静态优先，工作编号兜底；已合并的编号不再可用） */
export async function findTaxonOptionBySlug(env: Env, slug: string): Promise<TaxonOption | null> {
  const staticHit = STATIC_TAXA.find((t) => t.slug === slug);
  if (staticHit) return { slug: staticHit.slug, name: staticHit.scientific_name, cn: staticHit.chinese_name, rank: staticHit.rank };
  const row = await get<WorkingTaxonRow>(env.DB, "SELECT * FROM working_taxa WHERE slug = ? AND status != 'merged'", slug);
  if (!row) return null;
  return { slug: row.slug, name: row.scientific_name, cn: row.chinese_name, rank: row.rank, working: true };
}

export type RenameTaxonResult =
  | { ok: true; name: string; cn: string | null }
  | { ok: false; error: string; status: 400 | 404 | 409 };

/**
 * 工作编号改名（分类学变动之一：拼写修正 / 新组合保留为工作编号）。
 * slug 是永久标识（公开物种页 URL 依赖，规则 18/19 同理），改名不换 slug；
 * 当前鉴定行的 display 同步刷新，历史鉴定行保持当时原文（规则 17）。
 */
export async function renameWorkingTaxon(
  env: Env,
  slug: string,
  rawName: string,
  rawCn: string | null | undefined,
): Promise<RenameTaxonResult> {
  const row = await get<WorkingTaxonRow>(env.DB, "SELECT * FROM working_taxa WHERE slug = ? AND status != 'merged'", slug);
  if (!row) return { ok: false, status: 404, error: '工作编号不存在' };
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) return { ok: false, status: 400, error: '名称需为字母开头的学名（可含 cf. / aff. 等限定词）' };
  const newSlug = slugifyTaxonName(name);
  if (newSlug !== slug) {
    const clashStatic = staticSlugs.has(newSlug);
    const clashWorking = await get(env.DB, "SELECT 1 FROM working_taxa WHERE slug = ? AND slug != ?", newSlug, slug);
    if (clashStatic || clashWorking) return { ok: false, status: 409, error: '新名称与其它类群冲突；如确认是同一类群请用「合并」' };
  }
  const cn = rawCn == null ? row.chinese_name : String(rawCn).trim().slice(0, 60) || null;
  await run(env.DB, 'UPDATE working_taxa SET scientific_name = ?, chinese_name = ? WHERE slug = ?', name, cn, slug);
  // 当前鉴定 display 跟随（历史行不动）
  await run(
    env.DB,
    'UPDATE identifications SET display_identification = ? WHERE taxon_slug = ? AND is_current = 1',
    name,
    slug,
  );
  return { ok: true, name, cn };
}

export type MergeTaxonResult =
  | { ok: true; moved: number; targetName: string }
  | { ok: false; error: string; status: 400 | 404 };

/**
 * 合并（分类学变动之二：研究确认 cf./aff. 实为某正式类群，或两个工作编号实为同种）。
 * 只重指向当前鉴定；历史鉴定保留原 slug 与原文；来源编号标记 merged 不再可选。
 */
export async function mergeWorkingTaxon(
  env: Env,
  fromSlug: string,
  toSlug: string,
): Promise<{ ok: true; moved: number; targetName: string } | { ok: false; error: string; status: 400 | 404 }> {
  if (fromSlug === toSlug) return { ok: false, status: 400, error: '不能合并到自身' };
  const from = await get<WorkingTaxonRow>(env.DB, "SELECT * FROM working_taxa WHERE slug = ? AND status != 'merged'", fromSlug);
  if (!from) return { ok: false, status: 404, error: '来源工作编号不存在' };
  const to = await findTaxonOptionBySlug(env, toSlug);
  if (!to) return { ok: false, status: 404, error: '目标类群不存在' };
  const display = ['species', 'subspecies'].includes(to.rank) ? to.name : to.name + ' sp.';
  const cnt = await get<{ c: number }>(
    env.DB,
    'SELECT COUNT(*) AS c FROM identifications WHERE taxon_slug = ? AND is_current = 1',
    fromSlug,
  );
  await run(
    env.DB,
    'UPDATE identifications SET taxon_slug = ?, display_identification = ? WHERE taxon_slug = ? AND is_current = 1',
    to.slug,
    display,
    fromSlug,
  );
  await run(env.DB, "UPDATE working_taxa SET status = 'merged' WHERE slug = ?", fromSlug);
  return { ok: true, moved: cnt?.c ?? 0, targetName: to.name };
}

export type CreateTaxonResult =
  | { ok: true; taxon: TaxonOption; created: boolean; cnUpdated?: boolean }
  | { ok: false; error: string; status: number };

/** 建立（或复用）工作编号；与正式类群重名时拒绝。
 *  chineseName 语义与 renameWorkingTaxon 一致：null/undefined = 不动；空串 = 清空；非空 = 设置。 */
export async function createWorkingTaxon(env: Env, rawName: string, actor: string, chineseName?: string | null): Promise<CreateTaxonResult> {
  const name = rawName.trim().replace(/\s+/g, ' ');
  if (!NAME_RE.test(name)) {
    return { ok: false, status: 400, error: '工作编号需为字母开头的学名或编号（可含 cf. / aff. / sp. 等限定词）' };
  }
  const slug = slugifyTaxonName(name);
  if (!slug) return { ok: false, status: 400, error: '无法从该名称生成稳定缩写' };
  if (staticSlugs.has(slug)) {
    return { ok: false, status: 409, error: '与正式类群重名，请在列表中直接选择' };
  }
  const existing = await get<WorkingTaxonRow>(env.DB, 'SELECT * FROM working_taxa WHERE slug = ?', slug);
  if (existing) {
    // 已存在（可能是早前登记的正式学名或工作编号）：允许补录 / 修改中文名
    let cn = existing.chinese_name;
    let cnUpdated = false;
    if (chineseName != null) {
      const next = String(chineseName).trim().slice(0, 60) || null;
      if (next !== cn) {
        cn = next;
        cnUpdated = true;
        await run(env.DB, 'UPDATE working_taxa SET chinese_name = ? WHERE slug = ?', cn, slug);
      }
    }
    return {
      ok: true,
      created: false,
      cnUpdated,
      taxon: { slug: existing.slug, name: existing.scientific_name, cn, rank: existing.rank, working: true },
    };
  }
  const cn = chineseName ? String(chineseName).trim().slice(0, 60) || null : null;
  // 单词名 = 属级鉴定（显示为 Genus sp.）；双名及以上 = 种级
  const rank = name.indexOf(' ') === -1 ? 'genus' : 'species';
  await run(
    env.DB,
    'INSERT INTO working_taxa (slug, scientific_name, rank, status, chinese_name, created_by) VALUES (?,?,?,?,?,?)',
    slug,
    name,
    rank,
    'working',
    cn,
    actor,
  );
  return { ok: true, created: true, taxon: { slug, name, cn, rank, working: true } };
}
