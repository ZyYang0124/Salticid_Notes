// WSC（World Spider Catalog, wsc.nmbe.ch）正式学名核验。
// 规则（用户需求 2026-09）：
//   - 发布时属名 WSC 不存在 → 拦截发布；
//   - 种名（种加词）WSC 不存在 → 警告并建议降级为 Genus sp. / 工作编号；
//   - 周期重校验（cron）检测 WSC 端分类学变动，写入 wsc_findings 供数据质量页呈现。
// 注意：WSC 检索为模糊匹配，一切判定必须精确比对解析出的名字；网络不可达时降级放行（不阻塞野外记录）。
import { get, run, type Env } from './db';
import catalogJson from './wsc-genera.json';

const UA = 'SalticidNotes-Studio/1.0 (nature journal; +https://salticidnotes.cn)';
const TTL_DAYS = 30;

/** 学名是否带未定/存疑限定词——这类（工作编号语义）跳过 WSC 校验 */
export function hasOpenQualifier(display: string): boolean {
  return /\b(sp\.?|cf\.?|aff\.?|gen\.?\s*nov\.?|sp\.?\s*nov\.?|s\.?\s*l\.?)\b/i.test(display);
}

/** 拆解学名：属名 + 种加词（可选）。族/科级单词名不拆。 */
export function parseBinomial(display: string): { genus: string; epithet: string | null } {
  const words = display.trim().replace(/\s+/g, ' ').split(' ');
  const genus = words[0] ?? '';
  const second = words[1] ?? '';
  const epithet = second && /^[a-z][a-z-]+$/i.test(second) && !/^(sp|cf|aff|nov|sl)$/i.test(second) ? second.toLowerCase() : null;
  return { genus, epithet };
}

export interface WscVerdict {
  /** WSC 可达且完成核验 */
  checked: boolean;
  genusKnown: boolean;
  /** null = 无种加词或未核验 */
  speciesKnown: boolean | null;
  speciesStatus: string | null;
}

async function cached(env: Env, name: string): Promise<{ exists: boolean; status: string | null } | null> {
  const row = await get<{ exists_wsc: number; status: string | null; checked_at: string }>(
    env.DB,
    `SELECT exists_wsc, status, checked_at FROM wsc_cache WHERE name = ? AND checked_at > datetime('now', '-${TTL_DAYS} days')`,
    name,
  );
  if (!row) return null;
  return { exists: row.exists_wsc === 1, status: row.status };
}

async function saveCache(env: Env, name: string, kind: string, exists: boolean, status: string | null): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO wsc_cache (name, kind, exists_wsc, status, checked_at) VALUES (?,?,?,?,datetime('now'))
     ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, exists_wsc = excluded.exists_wsc, status = excluded.status, checked_at = excluded.checked_at`,
    name, kind, exists ? 1 : 0, status,
  );
}

async function fetchWsc(path: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch('https://wsc.nmbe.ch' + path, {
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: ctrl.signal,
      cf: { cacheTtl: 86400, cacheEverything: true },
    } as any);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 属名是否存在于 WSC：检索属名 → 进属详情页精确比对（检索是模糊匹配，不可直接信结果） */
export async function genusExists(env: Env, genus: string): Promise<boolean | null> {
  const key = genus.toLowerCase();
  const hit = await cached(env, 'g:' + key);
  if (hit) return hit.exists;
  const html = await fetchWsc(`/search?searchType=genus&query=${encodeURIComponent(genus)}`);
  if (html == null) return null; // 网络不可达：调用方降级
  const ids = [...html.matchAll(/genus-detail\/(\d+)/g)].map((m) => m[1]).slice(0, 2);
  for (const id of ids) {
    const detail = await fetchWsc(`/genus-detail/${id}/taxon`);
    if (detail == null) continue;
    const m = detail.match(/<h4[^>]*>\s*<em>([^<]+)<\/em>/);
    if (m && m[1].trim().toLowerCase() === key) {
      await saveCache(env, 'g:' + key, 'genus', true, 'GENUS');
      return true;
    }
  }
  await saveCache(env, 'g:' + key, 'genus', false, null);
  return false;
}

/** 种组合状态：精确匹配属+种加词；status 为 WSC 原文（ACCEPTED / SYNONYM 等） */
export async function speciesStatus(env: Env, genus: string, epithet: string): Promise<{ exists: boolean; status: string | null } | null> {
  const key = `${genus.toLowerCase()} ${epithet.toLowerCase()}`;
  const hit = await cached(env, 's:' + key);
  if (hit) return hit;
  const html = await fetchWsc(`/search?searchType=taxon&query=${encodeURIComponent(genus + ' ' + epithet)}`);
  if (html == null) return null;
  // 结果形如 <p><em>Genus epithet</em> Author - <span class="tag ...">STATUS</span>
  const entries = [...html.matchAll(/<em>([A-Za-z][a-z-]+)\s+([a-z-]+)<\/em>\s*[^-]*-\s*<span[^>]*>\s*([A-Z]+)/g)];
  let verdict: { exists: boolean; status: string | null } = { exists: false, status: null };
  for (const m of entries) {
    if (m[1].toLowerCase() === genus.toLowerCase() && m[2].toLowerCase() === epithet.toLowerCase()) {
      verdict = { exists: true, status: m[3] };
      break;
    }
  }
  await saveCache(env, 's:' + key, 'species', verdict.exists, verdict.status);
  return verdict;
}

/**
 * 发布前核验入口。仅核验「像正式双名」的学名（无 sp./cf./aff. 限定词，且有属+种加词）。
 * checked=false 表示 WSC 不可达或无需核验（不阻塞发布）。
 */
export async function validateFormalName(env: Env, display: string): Promise<WscVerdict> {
  const verdict: WscVerdict = { checked: false, genusKnown: false, speciesKnown: null, speciesStatus: null };
  if (hasOpenQualifier(display)) return verdict;
  const { genus, epithet } = parseBinomial(display);
  if (!genus || !epithet) return verdict; // 单词（科级）或 genus sp. 形态不核验
  const g = await genusExists(env, genus);
  if (g == null) return verdict;
  verdict.checked = true;
  verdict.genusKnown = g;
  if (!g) return verdict; // 属名未知：不再查种
  const s = await speciesStatus(env, genus, epithet);
  if (s == null) return verdict;
  verdict.speciesKnown = s.exists;
  verdict.speciesStatus = s.status;
  return verdict;
}


// ---------- 输入预测（typeahead）：属前缀 → 属列表；属名 → 该属 ACCEPTED 种列表 ----------

interface CacheRow { name: string; payload: string; checked_at: string }

async function cachedPayload(env: Env, key: string, ttlDays: number): Promise<unknown | null> {
  const row = await get<CacheRow>(
    env.DB,
    `SELECT payload, checked_at FROM wsc_cache WHERE name = ? AND checked_at > datetime('now', '-${ttlDays} days')`,
    key,
  );
  if (!row) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

async function savePayload(env: Env, key: string, payload: unknown): Promise<void> {
  await run(
    env.DB,
    `INSERT INTO wsc_cache (name, kind, exists_wsc, status, payload, checked_at) VALUES (?,?,1,NULL,?,datetime('now'))
     ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, payload = excluded.payload, checked_at = excluded.checked_at`,
    key, 'complete', JSON.stringify(payload),
  );
}

export interface GenusSuggestion { name: string; author: string | null }

const GENUS_CATALOG: string[] = (catalogJson as { genera: string[] }).genera;

/** 属名前缀预测：本地跳蛛科全属目录（引导自 Wikidata/WSC，年度更新），即时返回 */
export async function suggestGenera(env: Env, prefix: string): Promise<GenusSuggestion[] | null> {
  const lower = prefix.toLowerCase();
  const starts = GENUS_CATALOG.filter((g) => g.toLowerCase().startsWith(lower));
  const contains = GENUS_CATALOG.filter(
    (g) => !g.toLowerCase().startsWith(lower) && g.toLowerCase().includes(lower),
  ).slice(0, 12);
  return [...starts, ...contains].slice(0, 20).map((name) => ({ name, author: null }));
}

export interface SpeciesSuggestion { epithet: string; status: string }

/** 属下物种预测：返回该属全部组合及状态（客户端过滤 ACCEPTED），WSC 不可达返回 null */
export async function suggestSpecies(env: Env, genus: string): Promise<SpeciesSuggestion[] | null> {
  const key = 'complete:species:' + genus.toLowerCase();
  const hit = await cachedPayload(env, key, 14);
  if (hit) return hit as SpeciesSuggestion[];
  const html = await fetchWsc(`/search?searchType=genus&query=${encodeURIComponent(genus)}`);
  if (html == null) return null;
  const combos = [
    ...html.matchAll(/<em>([A-Za-z][a-z-]+)\s+([a-z-]+)<\/em>\s*[^-]*-\s*<span[^>]*>\s*([A-Z]+)/g),
  ]
    .filter((m) => m[1].toLowerCase() === genus.toLowerCase())
    .map((m) => ({ epithet: m[2], status: m[3] }));
  const out = combos.length ? combos : null;
  if (out) await savePayload(env, key, out);
  return out;
}
