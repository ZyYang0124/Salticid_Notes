// 环境绑定与 D1 查询助手。D1 是异步 API，全部 helper 返回 Promise。
export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ENVIRONMENT?: string;
  OWNER_EMAIL?: string;
  STUDIO_SESSION_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** 发布自动同步到 GitHub 仓库用（规则 5/7）；未配置时发布仍可用，仅不同步 */
  GITHUB_TOKEN?: string;
  /** 天地图密钥：地图瓦片与逆地理（国内可达）；未配置时回退 OSM/Nominatim（海外可达） */
  TIANDITU_KEY?: string;
}

export type Row = Record<string, any>;

export async function get<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | undefined> {
  const stmt = db.prepare(sql);
  const v = params.length ? await stmt.bind(...params).first<T>() : await stmt.first<T>();
  return (v ?? undefined) as T | undefined;
}

export async function all<T = Row>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const stmt = db.prepare(sql);
  const r = params.length ? await stmt.bind(...params).all<T>() : await stmt.all<T>();
  return (r.results ?? []) as T[];
}

export async function run(db: D1Database, sql: string, ...params: unknown[]): Promise<void> {
  const stmt = db.prepare(sql);
  if (params.length) await stmt.bind(...params).run();
  else await stmt.run();
}

export async function lastInsertId(db: D1Database, sql: string, ...params: unknown[]): Promise<number> {
  await run(db, sql, ...params);
  const row = await get<{ id: number }>(db, 'SELECT last_insert_rowid() AS id');
  return row!.id;
}

/** 编号计数器：原子自增并返回新值（sfn-media / sfn-observation-YYYY / post） */
export async function nextCounter(db: D1Database, name: string): Promise<number> {
  await run(db, 'INSERT INTO counters (name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1', name);
  const row = await get<{ value: number }>(db, 'SELECT value FROM counters WHERE name = ?', name);
  return row!.value;
}

export const pad6 = (n: number): string => String(n).padStart(6, '0');
