// 页面模板与视觉系统（UX Refresh）。
// 定位：野外记录本 + 写作桌 —— 不是 CMS / 后台。
// 与公开站同一套自然纸张语言：低饱和、安静、留白、图片优先。
import taxaJson from './taxa-data.json';
import type { StudioUser } from './auth';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));

export const TAXA = taxaJson as unknown as { slug: string; scientific_name: string; rank: string; chinese_name: string | null }[];

export const SITE_URL = 'https://salticidnotes.cn';

// ---------- 时间（全部按北京时间显示；Workers 上 new Date() 是 UTC，须显式换算） ----------

/** 内联进 <script> 的 JSON：转义 <，防止内容里的 </script> 提前闭合标签 */
const jsonForScript = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

const TZ = 'Asia/Shanghai';
function shParts(d: Date): { y: number; m: number; d: number; hh: string; mm: string } {
  const f = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), hh: p.hour === '24' ? '00' : p.hour, mm: p.minute };
}

export function greetingWord(): string {
  const { hh } = shParts(new Date());
  const h = Number(hh);
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 14) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** 相对时间：刚刚 / n 分钟前 / 今天 HH:MM / 昨天 / M月D日 / YYYY年M月D日 */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const now = new Date();
  const a = shParts(d), b = shParts(now);
  const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const sameDay = a.y === b.y && a.m === b.m && a.d === b.d;
  if (sameDay) return `今天 ${a.hh}:${a.mm}`;
  const yesterday = new Date(now.getTime() - 86400000);
  const yd = shParts(yesterday);
  if (a.y === yd.y && a.m === yd.m && a.d === yd.d) return `昨天 ${a.hh}:${a.mm}`;
  if (a.y === b.y) return `${a.m}月${a.d}日`;
  return `${a.y}年${a.m}月${a.d}日`;
}

// ---------- 视觉系统 ----------

export const STYLES = `
:root {
  --paper:#f7f5f0; --paper-deep:#efece4; --ink:#26221c; --muted:#6f675c; --faint:#988f80;
  --line:#e4ddcf; --line-soft:#ece7db; --accent:#566246; --terra:#a4552f;
  --serif: Georgia,"Times New Roman","Songti SC","Noto Serif SC",SimSun,serif;
  --sans: -apple-system,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  --fast:180ms; --normal:240ms; --ease:cubic-bezier(.22,1,.36,1);
  --w-note:720px;
}
* { box-sizing:border-box; }
[hidden] { display:none !important; }
html { -webkit-text-size-adjust:100%; }
body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.75 var(--sans); -webkit-font-smoothing:antialiased; }
a { color:inherit; }
button { font:inherit; cursor:pointer; }
@media (prefers-reduced-motion: reduce) { * { transition:none !important; animation:none !important; } }

/* ---- 顶栏 shell ---- */
.shell {
  position:sticky; top:0; z-index:40; display:flex; align-items:center; gap:22px;
  padding:0 max(20px, calc(50vw - 480px)); height:56px;
  background:color-mix(in srgb, var(--paper) 88%, transparent); backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line-soft);
}
.shell .brand { font-family:var(--serif); font-weight:700; font-size:17px; letter-spacing:.04em; text-decoration:none; display:flex; align-items:baseline; gap:8px; }
.shell .brand small { font-family:var(--sans); font-weight:400; font-size:11.5px; color:var(--faint); letter-spacing:.14em; }
.shell nav { display:flex; gap:4px; }
.shell nav a {
  text-decoration:none; color:var(--muted); font-size:14px; padding:5px 12px; border-radius:99px;
  transition:color var(--fast) ease, background var(--fast) ease;
}
.shell nav a:hover, .shell nav a.on { color:var(--ink); background:var(--paper-deep); }
.shell .right { margin-left:auto; display:flex; align-items:center; gap:14px; }
.shell .right .site { font-size:13px; color:var(--muted); text-decoration:none; }
.shell .right .site:hover { color:var(--ink); }
details.avatar { position:relative; }
details.avatar summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:center;
  width:32px; height:32px; border-radius:50%; background:var(--accent); color:#fff; font-size:14px; user-select:none; }
details.avatar summary::-webkit-details-marker { display:none; }
details.avatar .menu { position:absolute; right:0; top:40px; background:#fff; border:1px solid var(--line);
  border-radius:10px; padding:6px; min-width:150px; box-shadow:0 6px 24px rgba(38,34,28,.08); }
details.avatar .menu a, details.avatar .menu span { display:block; padding:8px 12px; font-size:14px; text-decoration:none; color:var(--ink); border-radius:8px; }
details.avatar .menu a:hover { background:var(--paper-deep); }
details.avatar .menu .who { color:var(--faint); font-size:12.5px; }

/* 编辑态顶栏：只留返回 + 状态 + 动作 */
.shell.editor-mode { gap:14px; }
.shell.editor-mode .back { text-decoration:none; color:var(--muted); font-size:14px; padding:5px 10px; border-radius:99px; transition:background var(--fast) ease, color var(--fast) ease; white-space:nowrap; }
.shell.editor-mode .back:hover { background:var(--paper-deep); color:var(--ink); }
#save-status { font-size:12.5px; color:var(--faint); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
#save-status.err { color:var(--terra); }
#save-status a { color:var(--accent); }
#bar-status a { color:var(--accent); }

/* ---- 通用元素 ---- */
main { min-height:calc(100vh - 56px); }
.wrap { max-width:960px; margin:0 auto; padding:40px 24px 120px; }
.wrap.narrow { max-width:var(--w-note); }
.kicker { font-size:11.5px; letter-spacing:.26em; color:var(--faint); font-weight:600; margin:44px 0 6px; }

button.primary, a.primary {
  display:inline-flex; align-items:center; justify-content:center; gap:6px;
  background:var(--ink); color:var(--paper); border:none; border-radius:99px;
  padding:10px 26px; font-size:14.5px; letter-spacing:.05em; text-decoration:none;
  transition:opacity var(--fast) ease, transform var(--fast) ease;
}
button.primary:hover, a.primary:hover { opacity:.86; }
button.primary:disabled { opacity:.45; cursor:default; }
button.ghost, a.ghost {
  display:inline-flex; align-items:center; gap:6px; background:none; border:none;
  color:var(--muted); font-size:14px; padding:8px 14px; border-radius:99px; text-decoration:none;
  transition:color var(--fast) ease, background var(--fast) ease;
}
button.ghost:hover, a.ghost:hover { color:var(--ink); background:var(--paper-deep); }

/* 字段：label + 值 + 轻边线，不做方框卡片 */
.field { margin:0 0 26px; }
.field > label { display:block; font-size:12.5px; color:var(--muted); letter-spacing:.06em; margin:0 0 6px; }
.field input[type=text], .field input[type=date], .field input[type=number], .field input[type=email],
.field input:not([type]), .field select, .field textarea {
  width:100%; border:none; border-bottom:1px solid var(--line); background:transparent;
  padding:7px 2px; font:inherit; color:var(--ink); border-radius:0;
  transition:border-color var(--fast) ease;
}
.field input:focus, .field select:focus, .field textarea:focus { outline:none; border-bottom-color:var(--accent); }
.field ::placeholder { color:var(--faint); }
.field .hint { display:block; font-size:12px; color:var(--faint); margin-top:5px; line-height:1.5; }
.field textarea { resize:vertical; min-height:84px; line-height:1.8; }
.row2 { display:grid; grid-template-columns:1fr 1fr; gap:0 26px; }
.row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 22px; }
.field-error { color:var(--terra); font-size:13px; margin-top:8px; display:none; }
.field-error.show { display:block; }

/* ---- 登录页 ---- */
.login-page { min-height:100vh; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:32px; }
.login-box { width:100%; max-width:360px; text-align:center; }
.login-brand { font-family:var(--serif); font-size:20px; letter-spacing:.08em; color:var(--muted); }
.login-brand b { display:block; font-size:44px; letter-spacing:.02em; color:var(--ink); margin:6px 0 10px; }
.login-tag { color:var(--muted); margin:0 0 44px; font-size:15px; }
.login-box input[type=email], .login-box input[type=text] {
  width:100%; border:none; border-bottom:1px solid var(--line); background:transparent;
  padding:10px 2px; font:inherit; text-align:center; color:var(--ink); border-radius:0;
}
.login-box input:focus { outline:none; border-bottom-color:var(--accent); }
.login-box ::placeholder { color:var(--faint); }
.login-box button.primary { width:100%; margin-top:26px; }
.login-foot { margin-top:34px; font-size:12.5px; color:var(--faint); letter-spacing:.1em; }
.login-err { color:var(--terra); font-size:13.5px; min-height:20px; margin:12px 0 0; }
.login-email-now { font-size:13px; color:var(--muted); margin:0 0 20px; }
.login-email-now a { color:var(--faint); }
.code-row { display:flex; gap:8px; justify-content:center; margin:6px 0 4px; }
.code-row input {
  width:46px; height:58px; text-align:center; font-size:24px; font-family:var(--serif);
  border:none; border-bottom:2px solid var(--line); background:transparent; color:var(--ink);
  border-radius:0; padding:0;
}
.code-row input:focus { outline:none; border-bottom-color:var(--accent); }
.resend { font-size:13px; color:var(--faint); margin:16px 0 0; }
.resend button { background:none; border:none; color:var(--muted); text-decoration:underline; text-underline-offset:3px; padding:0; font-size:13px; }
.resend button:disabled { color:var(--faint); text-decoration:none; cursor:default; }

/* ---- 首页 ---- */
.hello-wrap { margin:26px 0 34px; }
.hello-wrap h1 { font-family:var(--serif); font-weight:400; font-size:34px; margin:0 0 6px; }
.hello-wrap p { color:var(--muted); margin:0; }
.action-cards { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.action-card {
  border:1px solid var(--line); background:#fbfaf7; border-radius:14px; padding:22px 24px;
  text-decoration:none; display:block; transition:border-color var(--fast) ease, transform var(--fast) ease;
}
.action-card:hover { border-color:var(--faint); transform:translateY(-1px); }
.action-card .ic { font-size:20px; color:var(--accent); }
.action-card b { display:block; font-family:var(--serif); font-weight:400; font-size:19px; margin:8px 0 2px; }
.action-card span.sub { color:var(--muted); font-size:13.5px; }

.feed { list-style:none; margin:10px 0 0; padding:0; }
.feed li { border-bottom:1px solid var(--line-soft); }
.feed a { display:flex; align-items:baseline; gap:14px; padding:13px 4px; text-decoration:none; transition:background var(--fast) ease; }
.feed a:hover { background:rgba(0,0,0,.02); }
.feed .t { font-size:15.5px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.feed .meta { font-size:12.5px; color:var(--faint); white-space:nowrap; }
.feed .feed-row { display:flex; align-items:center; gap:14px; }
.feed .feed-row > a { flex:1; min-width:0; display:flex; align-items:baseline; gap:14px; text-decoration:none; transition:background var(--fast) ease; }
.feed .feed-row:hover > a { background:rgba(0,0,0,.02); }
.feed .acts { display:flex; gap:6px; flex:none; }
.act-btn {
  font-size:12px; color:var(--muted); text-decoration:none;
  border:1px solid var(--line); border-radius:99px; padding:4px 12px; background:none;
  transition:color var(--fast) ease, border-color var(--fast) ease;
}
.act-btn:hover { color:var(--ink); border-color:var(--faint); }
button.act-btn { cursor:pointer; }
.feed .st-draft { color:var(--terra); }
.feed .st-pub { color:var(--accent); }
.all-link { display:inline-block; margin-top:14px; font-size:13.5px; color:var(--muted); text-decoration:none; }
.all-link:hover { color:var(--ink); }
.empty { color:var(--faint); font-size:14.5px; padding:18px 4px; }
.empty a { color:var(--accent); }
/* ---- 首页（§4）：新建观察为绝对视觉中心 ---- */
.home .hello-wrap { margin-bottom: var(--s-6); }
.new-obs {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  width: 100%; padding: 34px 20px; margin: 0 0 10px;
  border: 1.5px solid var(--ink); border-radius: 8px;
  font-family: var(--serif); font-size: 24px; font-weight: 700; letter-spacing: 0.08em;
  color: var(--ink); text-decoration: none; background: var(--paper-soft);
  transition: border-color var(--normal) var(--ease), color var(--normal) var(--ease);
}
.new-obs:hover { border-color: var(--terra); color: var(--terra); }
.new-obs .plus { font-size: 30px; line-height: 1; }
.alt-link { display: inline-block; margin: 0 0 var(--s-8); font-size: 13.5px; color: var(--muted); text-decoration: none; }
.alt-link:hover { color: var(--terra); }
.home .kicker { margin-top: 0; }
.feed { list-style: none; margin: 0 0 var(--s-5); padding: 0; }
.feed > li { border-bottom: 1px solid var(--line-soft); }
.feed > li a {
  display: flex; align-items: center; gap: 14px; padding: 12px 4px;
  text-decoration: none; color: var(--ink);
}
.feed .thumb { width: 52px; height: 52px; object-fit: cover; flex: none; background: var(--paper-deep); display: block; }
.feed .t { font-family: var(--serif); font-size: 16.5px; display: block; min-width: 0; }
.feed .meta { display: block; font-size: 12.5px; color: var(--faint); }
.feed .go { margin-left: auto; color: var(--faint); flex: none; }
.feed > li a:hover .t { text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 3px; }
/* ---- 数据页 ---- */
.data-sync { border: 1px solid var(--line-soft); border-radius: 8px; background: var(--paper-soft); padding: 6px 18px; margin-bottom: var(--s-6); }
.data-sync .ro { display: flex; align-items: center; gap: 14px; padding: 12px 0; border-bottom: 1px solid var(--line-soft); flex-wrap: wrap; }
.data-sync .ro:last-child { border-bottom: none; }
.data-sync b { font-size: 14.5px; flex: none; }
.data-sync span { color: var(--muted); font-size: 13.5px; flex: 1; min-width: 200px; }
.data-links { display: flex; flex-direction: column; }
.data-row {
  display: flex; align-items: baseline; gap: 14px; padding: 15px 4px;
  border-bottom: 1px solid var(--line-soft); text-decoration: none; color: var(--ink);
}
.data-row b { font-size: 15.5px; flex: none; }
.data-row span { color: var(--muted); font-size: 13.5px; flex: 1; }
.data-row .go { color: var(--faint); flex: none; }
.data-row:hover b { color: var(--terra); }
/* ---- 记录列表搜索 ---- */
.rec-search { padding: 18px 0 4px; }
.rec-search input {
  width: 100%; max-width: 420px; font: inherit; font-size: 14px; color: var(--ink);
  padding: 9px 14px; border: 1px solid var(--line); border-radius: 8px; background: #fff; outline: none;
}
.rec-search input:focus { border-color: var(--terra); }
.home-foot { margin-top:64px; padding-top:18px; border-top:1px solid var(--line-soft); display:flex; gap:18px; }
.home-foot a { font-size:12.5px; color:var(--faint); text-decoration:none; }
.home-foot a:hover { color:var(--ink); }

/* ---- 观察编辑器 ---- */
.editor-main { max-width:760px; margin:0 auto; padding:34px 24px 130px; }
.editor-main h1 { font-family:var(--serif); font-weight:400; font-size:26px; margin:0 0 26px; }
.drop-big {
  border:1.5px dashed var(--line); border-radius:16px; background:#fbfaf7;
  padding:44px 20px; text-align:center; cursor:pointer; transition:border-color var(--fast) ease, background var(--fast) ease;
}
.drop-big:hover { border-color:var(--faint); background:#fff; }
.drop-big .plus { font-size:30px; color:var(--faint); display:block; line-height:1; }
.drop-big b { display:block; font-family:var(--serif); font-weight:400; font-size:18px; margin:10px 0 4px; }
.drop-big span { color:var(--faint); font-size:13.5px; }
.photo-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(108px, 1fr)); gap:10px; margin:14px 0 4px; }
.photo {
  position:relative; aspect-ratio:1; border-radius:10px; overflow:hidden; background:var(--paper-deep);
  cursor:pointer; border:1px solid var(--line-soft);
}
.photo img { width:100%; height:100%; object-fit:cover; display:block; }
.photo .badge {
  position:absolute; left:6px; top:6px; width:22px; height:22px; border-radius:50%;
  background:rgba(38,34,28,.72); color:#fff; font-size:11.5px; display:flex; align-items:center; justify-content:center;
}
.photo.cover .badge { background:var(--accent); }
.photo.uploading { opacity:.55; }
.photo.failed img { opacity:.4; filter:grayscale(.4); }
.photo .ph-veil {
  position:absolute; inset:0; background:rgba(20,17,12,.5);
  display:flex; align-items:center; justify-content:center; color:#fff;
}
.photo .ph-pct, .photo .ph-veil [data-pct] { font-size:13px; font-weight:600; letter-spacing:.04em; }
.photo .ph-retry {
  font:inherit; font-size:12px; color:#fff; background:rgba(181,64,44,.92);
  border:none; border-radius:99px; padding:5px 12px; cursor:pointer;
}
.photo .ph-retry:hover { background:#a03422; }
.photo-grid-add {
  aspect-ratio:1; border-radius:10px; border:1.5px dashed var(--line); background:none;
  color:var(--faint); font-size:22px; display:flex; align-items:center; justify-content:center; cursor:pointer;
  transition:border-color var(--fast) ease, color var(--fast) ease;
}
.photo-grid-add:hover { border-color:var(--faint); color:var(--ink); }
.photo-panel {
  border:1px solid var(--line); border-radius:14px; background:#fbfaf7; padding:18px 20px; margin:14px 0 6px;
}
.photo-panel .pp-head { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
.photo-panel .pp-head img { width:52px; height:52px; object-fit:cover; border-radius:8px; }
.photo-panel .pp-head b { font-size:12.5px; color:var(--muted); font-weight:600; letter-spacing:.04em; }
.photo-panel .pp-actions { display:flex; gap:4px; margin-top:12px; flex-wrap:wrap; }

/* 物种选择 */
.species-wrap { position:relative; }
.species-pop {
  position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:30; background:#fff;
  border:1px solid var(--line); border-radius:12px; box-shadow:0 10px 30px rgba(38,34,28,.10);
  max-height:290px; overflow:auto; padding:6px; display:none;
}
.species-pop.open { display:block; }
.species-pop .wsc-head { font-size:11px; letter-spacing:.14em; color:var(--faint); padding:8px 12px 2px; }
.species-pop .wsc-none { font-size:12.5px; color:var(--faint); padding:10px 12px; }
.species-pop .opt .meta { display:block; font-size:11.5px; color:var(--faint); }
.species-pop .opt { padding:9px 12px; border-radius:8px; cursor:pointer; display:flex; flex-direction:column; gap:1px; }
.species-pop .opt:hover, .species-pop .opt.sel { background:var(--paper-deep); }
.species-pop .opt .cn { font-size:14.5px; }
.species-pop .opt .sn { font-size:12.5px; color:var(--faint); font-style:italic; }
.species-pop .none { padding:12px; color:var(--faint); font-size:13.5px; }
.chosen-taxa { display:flex; align-items:center; gap:10px; padding:4px 0; }
.chosen-taxa .sn { font-style:italic; color:var(--ink); font-size:15.5px; }
.chosen-taxa button { background:none; border:none; color:var(--faint); font-size:12.5px; text-decoration:underline; text-underline-offset:3px; padding:0; }
.chosen-taxa button:hover { color:var(--ink); }
.cn-row { margin-top:8px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
#species-cn {
  width:250px; background:none; border:none; border-bottom:1px dashed var(--line);
  color:var(--ink); font-size:14.5px; padding:2px 4px; font-family:inherit;
}
#species-cn:focus { outline:none; border-bottom-color:var(--terra); border-bottom-style:solid; }
#species-cn::placeholder { color:var(--faint); }
#species-cn:disabled { opacity:.45; }
.cn-row .hint { font-size:12px; }

/* 坐标与地图 */
.coords-row { display:flex; align-items:baseline; gap:8px; flex-wrap:wrap; }
.coords-row .coord { flex:1; min-width:130px; display:flex; align-items:baseline; gap:4px; }
.coords-row .coord em { font-style:normal; color:var(--faint); font-size:13px; }
#map-box { margin-top:12px; border-radius:12px; overflow:hidden; border:1px solid var(--line); }
#map-box .map-inner { height:320px; }
#map-box .map-switch { position:absolute; top:8px; right:8px; z-index:500; display:flex; border-radius:8px; overflow:hidden; border:1px solid rgba(38,34,28,.25); }
.map-switch button {
  font:inherit; font-size:12px; padding:4px 12px; border:none; cursor:pointer;
  background:rgba(255,255,255,.88); color:var(--ink);
}
.map-switch button.on { background:var(--ink); color:var(--paper); }
.map-inner { position:relative; }
.map-pin { background:none; border:none; }
.map-pin .pin-dot {
  display:block; width:14px; height:14px; margin:4px; border-radius:50%;
  background:var(--terra); border:3px solid #fff; box-shadow:0 1px 6px rgba(20,17,12,.55);
}
.map-pin .pin-ring {
  position:absolute; inset:0; border-radius:50%;
  border:2px solid rgba(181,64,44,.55); animation:pin-pulse 2.2s ease-out infinite;
}
@keyframes pin-pulse { 0% { transform:scale(.6); opacity:1; } 100% { transform:scale(1.5); opacity:0; } }
@media (prefers-reduced-motion: reduce) { .map-pin .pin-ring { animation:none; opacity:.6; } }
.map-hint { font-size:12px; color:var(--faint); padding:8px 12px; background:#fbfaf7; border-top:1px solid var(--line-soft); }
#map-box.loading { display:flex; align-items:center; justify-content:center; height:200px; color:var(--faint); font-size:13.5px; }

/* 详细信息折叠 */
details.more { border-top:1px solid var(--line-soft); margin-top:8px; padding-top:6px; }
details.more summary { cursor:pointer; color:var(--muted); font-size:14px; padding:12px 0; list-style:none; }
details.more summary::-webkit-details-marker { display:none; }
details.more summary::before { content:'＋ '; color:var(--faint); }
details.more[open] summary::before { content:'－ '; }
details.more .grid { display:grid; grid-template-columns:1fr 1fr 1fr; gap:0 22px; margin-top:6px; }

/* 底部操作栏 */
.bottombar {
  position:fixed; left:0; right:0; bottom:0; z-index:40;
  display:flex; align-items:center; gap:12px;
  padding:10px max(20px, calc(50vw - 480px));
  background:color-mix(in srgb, var(--paper) 92%, transparent); backdrop-filter:blur(8px);
  border-top:1px solid var(--line-soft);
}
.bottombar .spacer { flex:1; }
.bottombar .pub-hint { font-size:12px; color:var(--faint); margin-right:auto; }
.status-menu {
  position:fixed; right:max(20px, calc(50vw - 480px)); bottom:58px; z-index:45;
  background:#fff; border:1px solid var(--line); border-radius:10px;
  box-shadow:0 6px 24px rgba(38,34,28,.10); padding:6px; min-width:132px;
}
.status-menu button { display:block; width:100%; text-align:left; background:none; border:none; padding:8px 12px; font-size:13.5px; color:var(--ink); border-radius:8px; }
.status-menu button:hover { background:var(--paper-deep); }
.photo-strip { display:flex; align-items:center; gap:14px; }
.photo-slot {
  width:160px; height:200px; border:1.5px dashed var(--line); border-radius:12px;
  display:flex; align-items:center; justify-content:center; flex-direction:column; gap:6px;
  color:var(--faint); font-size:20px; cursor:pointer; overflow:hidden; background:#fff;
}
.photo-slot img { width:100%; height:100%; object-fit:cover; display:block; }
.photo-slot span { font-size:12px; }
.row-actions { display:flex; align-items:center; gap:14px; margin-top:8px; }
.q-rows { border:1px solid var(--line-soft); border-radius:10px; background:#fff; padding:6px 0; max-width:520px; }
.q-row { padding:7px 16px; font-size:13.5px; color:var(--ink); border-bottom:1px solid var(--line-soft); }
.q-row:last-child { border-bottom:none; }
.q-row a { color: var(--ink); text-decoration: none; }
.q-row a:hover { text-decoration: underline; text-underline-offset: 3px; }
.pm-row { display:flex; align-items:center; justify-content:space-between; gap:16px; border:1px solid var(--line-soft); border-radius:12px; background:#fff; padding:14px 18px; margin-bottom:12px; }
.pm-main b { font-family:var(--serif); font-weight:400; font-size:17px; }
.pm-sub { display:block; font-size:12.5px; color:var(--faint); margin-top:2px; }
.pm-side { display:flex; align-items:center; gap:10px; }
.pm-count { font-size:12.5px; color:var(--faint); }
.pm-target { font:inherit; font-size:13px; padding:6px 10px; border:1px solid var(--line); border-radius:8px; background:#fff; color:var(--ink); }

/* ---- 野外笔记：写作模式 ---- */
.nb-toolbar {
  position: sticky; top: 0; z-index: 5;
  display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
  background: var(--paper); padding: 10px 0; margin-bottom: 6px;
  border-bottom: 1px solid var(--line-soft);
}
.nb-toolbar button {
  font: inherit; font-size: 13px; color: var(--muted);
  background: none; border: 1px solid transparent; border-radius: 6px;
  padding: 4px 10px; cursor: pointer;
}
.nb-toolbar button:hover { color: var(--ink); border-color: var(--line); background: var(--paper-soft); }
.nb-toolbar .sep { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.editor-main h1 { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.st-badge { font-size:12px; color:var(--faint); border:1px solid var(--line); border-radius:999px; padding:2px 10px; font-weight:400; }
.st-badge.pub { color:var(--terra); border-color:var(--terra); }
.ed-sec { margin-bottom:34px; }
.ed-sec-title {
  font-family:var(--sans); font-size:13px; font-weight:600; letter-spacing:.14em;
  color:var(--faint); margin:0 0 14px; padding-bottom:8px; border-bottom:1px solid var(--line-soft);
}
.exif-suggest {
  display:flex; align-items:center; gap:10px; flex-wrap:wrap;
  border:1px solid var(--line); border-radius:6px; background:var(--paper-soft);
  padding:8px 12px; margin-bottom:12px; font-size:13px; color:var(--ink);
}
.exif-suggest button {
  font:inherit; font-size:12.5px; padding:3px 12px; border-radius:99px; cursor:pointer;
  border:1px solid var(--line); background:#fff; color:var(--ink);
}
.exif-suggest button.use { border-color:var(--terra); color:var(--terra); }
.exif-groups {
  display:block; font-size:12.5px; color:#8a5a22; background:#f7ecdd;
  border:1px solid #ecd9bd; border-radius:8px; padding:8px 12px; margin:10px 0 0;
}

/* 观察选择器 */
.obs-picker {
  position: fixed; z-index: 400; width: 380px; max-height: 320px;
  background: #fff; border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 14px 40px rgba(38,34,28,.18); display: none; flex-direction: column; overflow: hidden;
}
.obs-picker.open { display: flex; }
.obs-picker .op-search { border: none; border-bottom: 1px solid var(--line-soft); padding: 10px 14px; font: inherit; font-size: 14px; outline: none; background: none; }
.obs-picker .op-list { overflow: auto; max-height: 230px; }
.op-item { padding: 9px 14px; cursor: pointer; display: flex; flex-direction: column; gap: 1px; border-bottom: 1px solid var(--line-soft); }
.op-item:hover { background: var(--paper-deep); }
.op-item b { font-size: 13px; letter-spacing: .04em; }
.op-item span { font-size: 12px; color: var(--muted); }
.op-item .op-draft { font-style: normal; font-size: 10.5px; color: #8a5a22; background: #f7ecdd; border-radius: 99px; padding: 1px 8px; margin-left: 6px; }
.op-none, .op-foot { padding: 8px 14px; font-size: 12px; color: var(--faint); }
.op-foot { border-top: 1px solid var(--line-soft); }

/* 札记版式选择器 */
.tpl-picker { display:flex; gap:8px; overflow-x:auto; padding:6px 2px 12px; }
.tpl-opt {
  flex:0 0 auto; font:inherit; text-align:left; cursor:pointer;
  background:#fff; border:1px solid var(--line); border-radius:10px; padding:8px 12px;
  display:flex; flex-direction:column; gap:1px; min-width:120px;
}
.tpl-opt b { font-size:13.5px; }
.tpl-opt span { font-size:11px; color:var(--faint); }
.tpl-opt:hover { border-color:var(--faint); }
.tpl-opt.on { border-color:var(--terra); box-shadow:0 0 0 1px var(--terra) inset; }
.tpl-opt.on b { color:var(--terra); }

/* 预览面板的模板特征（简化版，正式版式以主站为准） */
#pane-preview.tpl-folio .pv-body { columns:2; column-gap:32px; }
#pane-preview.tpl-dropcap .pv-body > p:first-of-type::first-letter { float:left; font-family:var(--serif); font-size:3.2em; line-height:.85; padding:4px 8px 0 0; color:var(--terra); font-weight:700; }
#pane-preview.tpl-field .pv-body { background:repeating-linear-gradient(0deg, transparent 0 27px, var(--line-soft) 27px 28px); padding:4px 14px; }
#pane-preview.tpl-quiet .pv-body { max-width:420px; margin:0 auto; }
#pane-preview.tpl-inversa { background:#1d1a14; color:#eae5d8; padding:20px; border-radius:6px; }
#pane-preview.tpl-inversa .pv-body { color:#eae5d8; }
#pane-preview.tpl-bigtype .pv-body h2::before { content:counter(sec, decimal-leading-zero); display:block; font-size:12px; color:var(--terra); letter-spacing:.2em; }
#pane-preview.tpl-bigtype .pv-body { counter-reset:sec; }
#pane-preview.tpl-tiba .pv-title::before { content:'「'; color:var(--terra); }
#pane-preview.tpl-tiba .pv-title::after { content:'」'; color:var(--terra); }
#pane-preview.tpl-gallery .pv-body { text-align:center; }
#pane-preview.tpl-marginalia .pv-body blockquote { border-left:3px solid var(--terra); background:none; }

/* ---------- 批量导入 ---------- */
.imp-drop {
  border:2px dashed var(--line); border-radius:14px; padding:36px 20px; text-align:center;
  cursor:pointer; color:var(--muted); background:#fff; margin:14px 0;
}
.imp-drop:hover, .imp-drop.over { border-color:var(--terra); color:var(--ink); }
.imp-drop .plus { font-size:30px; color:var(--faint); display:block; line-height:1; margin-bottom:6px; }
.imp-toolbar { display:flex; align-items:center; gap:14px; margin:14px 0 18px; flex-wrap:wrap; }
.imp-toolbar .spacer { flex:1; }
.imp-toolbar select { font:inherit; font-size:13.5px; border:1px solid var(--line); border-radius:8px; padding:4px 8px; background:#fff; }
.imp-toolbar .primary { font:inherit; font-size:14px; background:var(--ink); color:var(--paper); border:none; border-radius:99px; padding:9px 20px; cursor:pointer; }
.imp-toolbar .primary[disabled] { opacity:.5; cursor:default; }
.imp-grid { display:flex; flex-direction:column; gap:14px; }
.imp-card { display:flex; gap:14px; background:#fff; border:1px solid var(--line-soft); border-radius:12px; padding:14px; }
.imp-card img.imp-cover { width:150px; height:150px; object-fit:cover; border-radius:8px; background:var(--paper-deep); }
.imp-meta { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
.imp-meta b { font-size:15px; }
.imp-meta label { display:flex; align-items:center; gap:8px; font-size:13px; color:var(--muted); flex-wrap:wrap; }
.imp-meta input { border:1px solid var(--line); border-radius:8px; padding:4px 8px; font:inherit; font-size:13.5px; width:130px; }
.imp-meta input[type="number"] { width:110px; }
.imp-thumbs { display:flex; gap:6px; flex-wrap:wrap; margin-top:4px; }
.imp-thumbs img { width:44px; height:44px; object-fit:cover; border-radius:6px; background:var(--paper-deep); }
.imp-state { font-size:13px; color:var(--muted); }
.imp-state.ok { color:#4c6b3c; }
.imp-state.err { color:var(--terra); }
.imp-done a { color:var(--ink); text-underline-offset:3px; }
/* ---- 桌面右栏（§8） ---- */
@media (min-width:1100px) {
  .ed-wrap { display:grid; grid-template-columns:minmax(0,1fr) 230px; gap:40px; max-width:calc(var(--w-note) + 270px); margin:0 auto; padding:44px 24px 160px; }
  .editor-main { min-width:0; }
  .ed-rail {
    position:sticky; top:70px; align-self:start;
    display:flex; flex-direction:column; gap:22px;
    border-left:1px solid var(--line-soft); padding-left:26px; min-height:60vh;
  }
  .rail-nav { display:flex; flex-direction:column; gap:2px; }
  .rail-nav a {
    display:flex; align-items:center; justify-content:space-between; gap:8px;
    font-size:13.5px; color:var(--muted); text-decoration:none; padding:7px 8px; border-radius:6px;
  }
  .rail-nav a:hover { color:var(--ink); background:var(--paper-soft); }
  .rail-nav a i { font-style:normal; color:var(--terra); font-weight:700; visibility:hidden; }
  .rail-nav a.done i { visibility:visible; }
}
@media (max-width:1099px) { .ed-rail { display:none; } }
/* ---- 发布按钮：唯一红色 CTA（§47） ---- */
button.primary, .pd-actions .primary {
  background:var(--terra); color:#fff; border:none; border-radius:6px;
  padding:10px 22px; font:inherit; font-size:14.5px; cursor:pointer;
}
button.primary:hover, .pd-actions .primary:hover { opacity:.9; }
button.ghost { background:none; border:none; color:var(--muted); font:inherit; font-size:13.5px; cursor:pointer; }
button.ghost:hover { color:var(--ink); }
/* ---- 发布成功面板（§35） ---- */
.publish-done { position:fixed; inset:0; z-index:80; background:var(--paper); display:flex; align-items:center; justify-content:center; padding:24px; }
.pd-box { max-width:440px; width:100%; text-align:center; }
.pd-check { width:64px; height:64px; margin:0 auto 18px; border-radius:50%; background:var(--terra); color:#fff; font-size:30px; line-height:64px; }
.pd-box h2 { font-family:var(--serif); font-size:28px; font-weight:700; margin:0 0 6px; }
.pd-id { font-size:14px; color:var(--faint); letter-spacing:.08em; margin-bottom:10px; }
.pd-box p { color:var(--ink); font-size:15px; line-height:1.9; margin:0 0 26px; }
.pd-actions { display:flex; flex-direction:column; gap:12px; }
.pd-actions a, .pd-actions button { text-decoration:none; text-align:center; padding:11px 18px; border-radius:6px; font-size:14.5px; }
.pd-actions .ghost, .pd-actions button.ghost { border:1px solid var(--line); color:var(--muted); background:none; }
.pd-actions .ghost:hover { color:var(--ink); border-color:var(--faint); }
.pd-warn { margin-top:18px; font-size:13px; color:var(--terra); line-height:1.8; text-align:left; }
/* ---- 移动端底部操作条（§9） ---- */
@media (max-width:700px) {
  .editor-main h1 { font-size:20px; }
  .ed-sec-title { font-size:12.5px; }
}
.write-main { max-width:var(--w-note); margin:0 auto; padding:44px 24px 160px; }
/* ---- 宽屏：左写右排（边写边排版） ---- */
@media (min-width:1100px) {
  .write-main.split {
    display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr);
    gap:0; max-width:none; width:100%; height:calc(100vh - 58px);
    padding:0; margin:0; overflow:hidden;
  }
  .write-main.split #pane-edit { overflow-y:auto; padding:44px 30px 160px; }
  .write-main.split #pane-preview {
    overflow-y:auto; height:100%; padding:44px 30px 160px;
    border-left:1px solid var(--line-soft); background:var(--paper);
  }
  .write-main.split .preview-label {
    display:block; font-size:11.5px; letter-spacing:.12em; color:var(--faint); margin:0 0 18px;
  }
}
.preview-label { display:none; }
/* 宽屏下切换器与独立预览按钮隐藏 */
@media (min-width:1100px) {
  .write-main.split ~ .fab-add { left: calc(25vw + 44px); right: auto; }
  /* 分栏常驻时切换器与独立预览按钮无意义 */
  #note-seg, #btn-preview2 { display:none; }
}
.title-line, .subtitle-line {
  width:100%; border:none; background:transparent; font-family:var(--serif); color:var(--ink); padding:0;
}
.title-line { font-size:34px; font-weight:400; margin:0 0 2px; }
.subtitle-line { font-size:16px; color:var(--muted); margin-bottom:26px; }
.title-line:focus, .subtitle-line:focus { outline:none; }
.title-line::placeholder, .subtitle-line::placeholder, .body-line::placeholder { color:var(--faint); opacity:.7; }
.body-line {
  width:100%; min-height:52vh; border:none; background:transparent; font-family:var(--serif);
  font-size:17.5px; line-height:2; color:var(--ink); padding:0; resize:none;
}
.body-line:focus { outline:none; }
.fab-add {
  position:fixed; z-index:35; bottom:86px; left:50%; transform:translateX(min(330px, 42vw));
  width:40px; height:40px; border-radius:50%; border:1px solid var(--line); background:#fff;
  color:var(--muted); font-size:20px; line-height:1; box-shadow:0 4px 16px rgba(38,34,28,.08);
  transition:color var(--fast) ease, border-color var(--fast) ease;
}
.fab-add:hover { color:var(--ink); border-color:var(--faint); }
.block-menu {
  position:fixed; z-index:50; bottom:134px; left:50%; transform:translateX(min(330px, 42vw));
  background:#fff; border:1px solid var(--line); border-radius:12px; box-shadow:0 10px 30px rgba(38,34,28,.12);
  padding:6px; width:190px; display:none;
}
.block-menu.open { display:block; }
.block-menu button {
  display:block; width:100%; text-align:left; background:none; border:none; padding:9px 12px;
  font-size:14px; color:var(--ink); border-radius:8px;
}
.block-menu button:hover { background:var(--paper-deep); }
.block-menu .sep { border-top:1px solid var(--line-soft); margin:4px 0; }
/* 编辑 ⇄ 预览 切换 */
.seg { display:flex; background:var(--paper-deep); border-radius:99px; padding:3px; }
.seg button { border:none; background:none; padding:4px 14px; border-radius:99px; font-size:13px; color:var(--muted); transition:all var(--fast) ease; }
.seg button.on { background:#fff; color:var(--ink); }
.preview-pane { animation:fadein var(--normal) var(--ease); }
.preview-pane .pv-title { font-family:var(--serif); font-weight:400; font-size:34px; margin:0 0 4px; color:var(--ink); }
.preview-pane .pv-sub { color:var(--muted); margin:0 0 30px; }
.preview-pane .pv-body:empty + .pv-sub, .preview-pane .pv-body:empty { display:none; }
@keyframes fadein { from { opacity:0; } to { opacity:1; } }
/* 设置抽屉 */
.drawer-mask { position:fixed; inset:0; background:rgba(38,34,28,.18); z-index:60; opacity:0; pointer-events:none; transition:opacity var(--normal) var(--ease); }
.drawer { position:fixed; top:0; right:0; bottom:0; width:min(360px, 92vw); background:var(--paper); z-index:61;
  border-left:1px solid var(--line); padding:26px 26px 40px; overflow:auto;
  transform:translateX(100%); transition:transform var(--normal) var(--ease); }
body.drawer-open .drawer { transform:translateX(0); }
body.drawer-open .drawer-mask { opacity:1; pointer-events:auto; }
.drawer h3 { font-family:var(--serif); font-weight:400; font-size:19px; margin:0 0 20px; }
.drawer .ro { font-size:14px; color:var(--muted); padding:2px 0 14px; }
.drawer .ro b { display:block; font-size:12px; color:var(--faint); font-weight:600; letter-spacing:.08em; margin-bottom:3px; }

/* ---- 文章预览（与公开站 Article Renderer 同一套布局语义） ---- */
.article-body { font-family:var(--serif); font-size:17px; line-height:1.95; }
.article-body h2 { font-family:var(--serif); font-size:25px; letter-spacing:.02em; color:var(--ink); margin:46px 0 14px; }
.article-body h3 { font-family:var(--serif); font-size:19.5px; color:var(--ink); margin:34px 0 10px; }
.article-body p { margin:0 0 18px; }
.article-body img { width:100%; height:auto; display:block; border-radius:4px; }
.article-body figure { margin:26px 0; }
.article-body figcaption { font:12.5px/1.6 var(--sans); color:var(--muted); margin-top:8px; }
.article-body .am-portrait { max-width:62%; margin-left:auto; margin-right:auto; }
.article-body .am-panorama { max-width:none; }
.article-media-group { display:grid; gap:12px; margin:26px 0; }
.amg-pair { grid-template-columns:1fr 1fr; }
.amg-triptych { grid-template-columns:1fr 1fr 1fr; }
.amg-grid4 { grid-template-columns:1fr 1fr; }
.amg-grid { grid-template-columns:1fr 1fr; }
.article-media-group .am { margin:0; }
.article-embed { border:1px solid var(--line); background:#fff; padding:14px 18px; margin:22px 0; font-family:var(--sans); font-size:14px; border-radius:12px; }
.article-embed.is-missing { color:var(--terra); }
.article-embed a { text-decoration:none; display:flex; gap:14px; align-items:center; }
.article-embed img { width:84px; height:84px; object-fit:cover; border-radius:8px; }
.embed-id { color:var(--faint); font-size:12px; display:block; }
.article-body blockquote { margin:22px 0; padding:2px 0 2px 18px; border-left:2px solid var(--line); color:var(--muted); }
.article-body hr { border:none; border-top:1px solid var(--line-soft); margin:36px auto; width:120px; }

/* ---- 媒体页 ---- */
.media-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); gap:12px; }
.media-grid a { text-decoration:none; display:block; }
.media-grid .ph { aspect-ratio:4/3; border-radius:10px; overflow:hidden; background:var(--paper-deep); border:1px solid var(--line-soft); }
.media-grid img { width:100%; height:100%; object-fit:cover; display:block; transition:transform var(--normal) var(--ease); }
.media-grid a:hover img { transform:scale(1.03); }
.media-grid .pid { font-size:11.5px; color:var(--faint); margin-top:5px; letter-spacing:.04em; }

/* ---- 邀请页 ---- */
.invite-table { width:100%; border-collapse:collapse; font-size:14px; }
.invite-table td { padding:10px 8px; border-bottom:1px solid var(--line-soft); }
.invite-table code { font-size:12px; color:var(--faint); }

/* ---- 移动端 ---- */
@media (max-width:720px) {
  .shell { gap:10px; padding:0 14px; }
  .shell nav a { padding:5px 9px; font-size:13.5px; }
  .shell .right .site { display:none; }
  .wrap { padding:26px 18px 100px; }
  .editor-main { padding:24px 18px 140px; }
  .write-main { padding:30px 20px 170px; }
  .action-cards { grid-template-columns:1fr; gap:10px; }
  .hello-wrap h1 { font-size:28px; }
  .row2, .row3, details.more .grid { grid-template-columns:1fr; gap:0; }
  .title-line { font-size:27px; }
  .bottombar { padding:10px 14px calc(10px + env(safe-area-inset-bottom)); }
  .bottombar button.primary { padding:11px 30px; }
  .code-row input { width:42px; height:52px; font-size:21px; }
  .fab-add { bottom:96px; transform:translateX(min(150px, 38vw)); }
  .block-menu { bottom:144px; transform:translateX(min(150px, 38vw)); }
  .shell.editor-mode .seg { margin-left:auto; }
  .shell.editor-mode .back span { display:none; }
}
@media (max-width:400px) {
  .shell nav a { padding:5px 7px; font-size:13px; }
  .code-row { gap:6px; } .code-row input { width:38px; height:50px; }
}
`;

// ---------- Shell ----------

export function page(
  title: string,
  body: string,
  user: StudioUser | null = null,
  opts: { editor?: boolean; actions?: string } = {},
): string {
  const initial = user ? user.display_name.slice(0, 1) : '';
  const head = opts.editor
    ? `<a class="back" href="/studio"><span>← </span>工作台</a><div id="save-status" aria-live="polite"></div><div class="right">${opts.actions ?? ''}</div>`
    : `<a class="brand" href="/studio">Studio<small>红栏杆跳蛛观察志</small></a>
  <nav>
    <a href="/studio/drafts">观察</a>
    <a href="/studio/import">批量导入</a>
    ${user?.role === 'owner' ? '<a href="/studio/places-manage">地点</a><a href="/studio/data">数据</a>' : ''}
  </nav>
  <div class="right">
    <a class="site" href="${SITE_URL}" target="_blank" rel="noopener">查看主站 ↗</a>
    ${user ? `<details class="avatar"><summary>${esc(initial)}</summary><div class="menu"><span class="who">${esc(user.display_name)}</span><a href="/studio/profile">个人资料</a><a href="/studio/logout">退出登录</a></div></details>` : ''}
  </div>`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)} · Studio</title><link rel="icon" type="image/svg+xml" href="/favicon.svg"><link rel="stylesheet" href="/studio.css"></head>
<body><header class="shell${opts.editor ? ' editor-mode' : ''}">${head}</header>${body}</body></html>`;
}

// ---------- 登录页（两步：邮箱 → 六位验证码） ----------

export function loginPage(opts: { devNotice: boolean }): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>登录 · 红栏杆跳蛛观察志 Studio</title><link rel="stylesheet" href="/studio.css"></head>
<body>
  <div class="login-page"><div class="login-box">
    <div class="login-brand">红栏杆跳蛛观察志<b>Studio</b></div>
    <p class="login-tag">把一次相遇留下来。</p>
    <div id="step-email">
      <input type="email" id="login-email" placeholder="邮箱地址" autocomplete="email" autofocus />
      <button class="primary" id="btn-send">发送验证码</button>
    </div>
    <div id="step-code" style="display:none">
      <p class="login-email-now">验证码已发送至 <b id="code-email"></b>　<a href="/studio/login">换个邮箱</a></p>
      <div class="code-row">${'<input type="text" inputmode="numeric" maxlength="1" autocomplete="one-time-code" />'.repeat(6)}</div>
      <p class="login-err" id="code-err"></p>
      <button class="primary" id="btn-verify">登录</button>
      <p class="resend"><button type="button" id="btn-resend" disabled>重新发送（<span id="resend-s">48</span>s）</button></p>
    </div>
    <p class="login-err" id="email-err"></p>
    ${opts.devNotice ? '<p class="login-foot">开发模式：验证码同时输出到 Worker 日志</p>' : ''}
    <p class="login-foot">仅供受邀伙伴使用 · 没有公开注册</p>
  </div></div>
  <script src="/studio-login.js"></script></body></html>`;
}

// ---------- 首页 / 草稿页 ----------

export interface FeedItem {
  kind: 'obs' | 'note';
  publicId: string;
  href: string;
  title: string;
  status: 'draft' | 'published' | 'private' | 'archived';
  /** 站长视图：记录创建者昵称 */
  author?: string;
  timeText: string;
  /** 排序键：源时间戳（毫秒） */
  ts: number;
  /** 封面缩略图（观察） */
  thumb?: string | null;
  /** 地点摘要（观察） */
  place?: string | null;
}

const STATUS_ZH: Record<string, string> = { draft: '草稿', published: '已发布', private: '私密', archived: '已归档' };

function feedHtml(items: FeedItem[], emptyHtml: string, showAuthor = false): string {
  if (!items.length) return `<p class="empty">${emptyHtml}</p>`;
  return `<ul class="feed">${items
    .map(
      (it) => `<li><a href="${esc(it.href)}">
      ${it.thumb ? `<img class="thumb" src="${esc(it.thumb)}" alt="" loading="lazy" />` : ''}
      <span class="t">${esc(it.title)}</span>
      ${it.place ? `<span class="meta">${esc(it.place)}</span>` : ''}
      <span class="meta">${it.kind === 'obs' ? '观察' : '札记'} · ${showAuthor && it.author ? esc(it.author) + ' · ' : ''}<span class="${it.status === 'draft' ? 'st-draft' : 'st-pub'}">${STATUS_ZH[it.status] ?? it.status}</span> · ${esc(it.timeText)}</span>
      <span class="go" aria-hidden="true">→</span>
    </a></li>`,
    )
    .join('')}</ul>`;
}

export function homePage(user: StudioUser, recent: FeedItem[]): string {
  return page('工作台', `
  <div class="wrap home">
    <div class="hello-wrap">
      <h1>${greetingWord()}，${esc(user.display_name)}</h1>
      <p>把一次相遇留下来。</p>
    </div>
    <a class="new-obs" href="/studio/observations/new"><span class="plus">＋</span> 新建观察</a>
    <a class="alt-link" href="/studio/notes/new">或写一篇札记 →</a>
    <a class="alt-link" href="/studio/import">或批量导入一整个野外批次 →</a>
    <h2 class="kicker">最近编辑</h2>
    ${feedHtml(recent.slice(0, 6), '还没有记录。从上面的「新建观察」开始。', user.role === 'owner')}
    <a class="all-link" href="/studio/drafts">查看全部观察 →</a>
  </div>`, user);
}

// 数据页（§43）：技术型功能统一归拢，不进入日常记录流
export function dataPage(user: StudioUser): string {
  const rows: { label: string; desc: string; href: string }[] = [
    { label: '数据质量', desc: '缺坐标、未挂接地点、WSC 变动等体检结果', href: '/studio/quality' },
    { label: '类群管理', desc: '工作编号改名与合并（WSC 变动的收口处）', href: '/studio/taxa-manage' },
    { label: '媒体库', desc: '独立插图与头像等非观察媒体', href: '/studio/media' },
    { label: '邀请伙伴', desc: '受邀邮箱列表与新邀请', href: '/studio/invite' },
  ];
  return page('数据', `
  <div class="wrap">
    <div class="hello-wrap"><h1>数据</h1><p>备份、体检与内部管理。日常记录用不到这里。</p></div>
    <div class="data-sync">
      <div class="ro"><b>同步公开站</b><span id="sync-status">发布时会自动同步；这里可手动触发。</span></div>
      <div class="ro"><b>导出备份</b><span>全部已发布内容与原图打包（zip）</span><a class="act-btn" href="/studio/export">下载</a></div>
    </div>
    <div class="data-links">
      ${rows
        .map((r) => `<a class="data-row" href="${r.href}"><b>${r.label}</b><span>${r.desc}</span><span class="go">→</span></a>`)
        .join('')}
    </div>
  </div>
  <script>
  (function () {
    var btn = document.querySelector('.data-sync .ro b');
    if (!btn) return;
    var row = btn.parentElement;
    var act = document.createElement('button');
    act.className = 'act-btn'; act.type = 'button'; act.textContent = '立即同步';
    row.insertBefore(act, row.querySelector('span'));
    act.addEventListener('click', function () {
      act.disabled = true;
      var st = row.querySelector('span');
      var old = st.textContent;
      st.textContent = '同步中…';
      fetch('/studio/api/sync', { method: 'POST' })
        .then(function (r) { return r.json(); })
        .then(function (j) { st.textContent = j.ok ? '已同步 ✓（公开站构建约 1-2 分钟后上线）' : '同步失败：' + (j.detail || ''); act.disabled = false; })
        .catch(function () { st.textContent = '网络异常，请重试'; act.disabled = false; });
    });
  })();
  </script>`, user);
}

// 记录列表（§16-§20）：四状态分区 + 快捷动作。发布=立即公开；归档不直接公开。
export function draftsPage(user: StudioUser, items: FeedItem[], showAuthor = false): string {
  const by = (st: FeedItem['status']) => items.filter((i) => i.status === st);
  const sections: { label: string; empty: string; items: FeedItem[] }[] = [
    { label: '草稿', empty: '还没有草稿。<a href="/studio/observations/new">记录第一次相遇</a> 或 <a href="/studio/notes/new">写一篇札记</a>。', items: by('draft') },
    { label: '已发布', empty: '还没有发布过。', items: by('published') },
    { label: '私密', empty: '没有私密记录。', items: by('private') },
    { label: '已归档', empty: '没有已归档的记录。', items: by('archived') },
  ];
  const searchBox = `<input id="rec-search" placeholder="搜索学名、地点、编号…" autocomplete="off" />`;
  const actions = (it: FeedItem): string => {
    const id = esc(it.publicId);
    const api = (act: string) => `/studio/api/${it.kind === 'obs' ? 'observations' : 'notes'}/${id}/${act}`;
    const btn = (act: string, label: string) => `<button type="button" class="act-btn" data-api="${api(act)}">${label}</button>`;
    const edit = `<a class="act-btn" href="${esc(it.href)}">编辑</a>`;
    if (it.kind === 'note') {
      if (it.status === 'draft') return edit + btn('publish', '发布');
      return edit + `<a class="act-btn" href="${SITE_URL}/posts/${id}/" target="_blank" rel="noopener">查看</a>`;
    }
    if (it.status === 'draft') return edit + btn('publish', '发布');
    if (it.status === 'published') {
      return (
        edit +
        `<a class="act-btn" href="${SITE_URL}/observations/${id}/" target="_blank" rel="noopener">查看</a>` +
        btn('private', '设为私密') +
        btn('archive', '归档')
      );
    }
    if (it.status === 'private') return edit + btn('publish', '发布');
    return edit + btn('restore', '恢复为草稿');
  };
  const section = (s: { label: string; empty: string; items: FeedItem[] }): string => `
    <h2 class="kicker">${s.label}</h2>
    ${
      s.items.length
        ? `<ul class="feed">${s.items
            .map(
              (it) => `<li><div class="feed-row">
        <a href="${esc(it.href)}">
          <span class="t">${esc(it.title)}</span>
          <span class="meta">${it.kind === 'obs' ? '观察' : '札记'} · <span class="${it.status === 'draft' ? 'st-draft' : 'st-pub'}">${STATUS_ZH[it.status]}</span> · ${esc(it.timeText)}</span>
        </a>
        <div class="acts">${actions(it)}</div>
      </div></li>`,
            )
            .join('')}</ul>`
        : `<p class="empty">${s.empty}</p>`
    }
  `;
  return page('观察', `
  <div class="wrap">
    <div class="hello-wrap"><h1>观察</h1><p>草稿、已发布、私密与已归档都在这里。</p></div>
    <div class="rec-search">${searchBox}</div>
    ${sections.map(section).join('')}
  </div>
  <script>
  (function () {
    Array.prototype.slice.call(document.querySelectorAll('button[data-api]')).forEach(function (b) {
      b.addEventListener('click', function () {
        b.disabled = true;
        fetch(b.getAttribute('data-api'), { method: 'POST' })
          .then(function (r) { return r.json(); })
          .then(function (j) {
            if (j && j.ok) location.reload();
            else { b.disabled = false; alert((j && j.error) || '操作失败'); }
          })
          .catch(function () { b.disabled = false; alert('网络异常，请重试'); });
      });
    });
    var rs = document.getElementById('rec-search');
    if (rs) {
      rs.addEventListener('input', function () {
        var q = rs.value.trim().toLowerCase();
        Array.prototype.slice.call(document.querySelectorAll('.feed > li')).forEach(function (li) {
          li.style.display = !q || li.textContent.toLowerCase().indexOf(q) !== -1 ? '' : 'none';
        });
      });
    }
  })();
  </script>`, user);
}

// ---------- 媒体页 ----------

export function mediaPage(
  rows: { public_id: string; thumb: string; obs_public_id: string | null }[],
  owner: boolean,
  counts: { observations: number; posts: number },
  user: StudioUser,
): string {
  return page('媒体', `
  <div class="wrap">
    <div class="hello-wrap"><h1>媒体</h1><p>已发布的影像，按编号倒序。点击打开所属观察。</p></div>
    ${
      rows.length
        ? `<div class="media-grid">${rows
            .map(
              (m) => `<a href="${m.obs_public_id ? `/studio/observations/${m.obs_public_id}/edit` : '#'}">
        <div class="ph"><img src="${esc(m.thumb)}" alt="${esc(m.public_id)}" loading="lazy" /></div>
        <div class="pid">${esc(m.public_id)}</div></a>`,
            )
            .join('')}</div>`
        : '<p class="empty">还没有已发布的影像。</p>'
    }
    ${
      owner
        ? `<div class="home-foot"><a href="/studio/export">导出备份（zip）· 当前观察 ${counts.observations} 条 · 札记 ${counts.posts} 篇</a></div>`
        : ''
    }
  </div>`, user);
}

// ---------- 观察编辑器 ----------

export interface ObsPhoto {
  public_id: string;
  thumb: string;
  caption: string | null;
  photographer_name: string | null;
  is_cover: number;
}

export interface ObsBootMeta {
  status: string;
  hasUnpublished: boolean;
  tiandituKey?: string;
  photoMeta: { public_id: string; caption: string | null; photographer_name: string | null; view_type: string }[];
}

/** 物种选择器选项：正式类群 + 工作编号（§21-§24） */
export interface EditorTaxon {
  slug: string;
  name: string;
  cn: string | null;
  rank: string;
  working?: boolean;
}

export function obsEditorHtml(
  publicId: string | null,
  data: Record<string, any>,
  photos: ObsPhoto[],
  meta: ObsBootMeta,
  taxaOptions: EditorTaxon[],
): string {

  const photoGrid = photos
    .map(
      (p, i) => `<div class="photo${p.is_cover ? ' cover' : ''}" data-pid="${p.public_id}">
      <img src="${esc(p.thumb)}" alt="" loading="lazy" />
      <span class="badge">${p.is_cover ? '★' : i + 1}</span>
    </div>`,
    )
    .join('\n');
  const published = meta.status === 'published';
  const actions = '';
  const speciesNow = data.species_taxon_slug ? (data.display_identification || publicId) : (publicId ? publicId : '记录一次相遇');
  const statusBadge = meta.status === 'published' ? '<span class="st-badge pub">已发布</span>' : meta.status === 'private' ? '<span class="st-badge">私密</span>' : meta.status === 'archived' ? '<span class="st-badge">已归档</span>' : '';
  return page(publicId ? `编辑 ${speciesNow}` : '记录一次相遇', `
  <div class="ed-wrap">
  <main class="editor-main">
    <h1>${publicId ? esc(publicId) : '记录一次相遇'} ${statusBadge}</h1>

    <section class="field ed-sec" id="sec-photos">
      <h2 class="ed-sec-title">照片</h2>
      <div id="drop-big" class="drop-big"${photos.length ? ' hidden' : ''}>
        <span class="plus">＋</span>
        <b>添加照片</b>
        <span>拍照 · 从相册选择 · 可多选 · 支持 Ctrl+V 粘贴</span>
      </div>
      <div class="photo-grid" id="photo-grid">${photoGrid}</div>
      <button type="button" class="photo-grid-add" id="photo-add"${photos.length ? '' : ' hidden'} aria-label="添加照片">＋</button>
      <div class="photo-panel" id="photo-panel" hidden></div>
      <div class="field-error" id="photo-err"></div>
      <input type="file" id="photo-camera" accept="image/jpeg,image/png" capture="environment" multiple hidden />
      <input type="file" id="photo-library" accept="image/jpeg,image/png" multiple hidden />
    </section>

    <section class="field ed-sec" id="sec-time">
      <h2 class="ed-sec-title">时间与地点</h2>
      <div class="exif-suggest" id="exif-suggest" hidden></div>
      <div class="exif-groups" id="exif-groups" hidden></div>
      <label>观察日期</label>
      <input type="date" data-field="observed_at" />
      <span class="hint" id="exif-hint">上传照片后可从 EXIF 读取拍摄时间与坐标</span>
    </section>

    <section class="field ed-sec" id="sec-place">
      <label>地点</label>
      <input id="place-search" placeholder="搜索已有地点（名称 / 省市），或直接在下方填写" autocomplete="off" value="${esc(data.placeName ?? '')}" />
      <div class="species-pop" id="place-pop"></div>
      <span class="hint" id="place-hint"></span>
      <div class="coords-row" style="margin-top:10px">
        <span class="coord"><input data-field="latitude" inputmode="decimal" placeholder="21.927381" /><em id="lat-hemi">N</em></span>
        <span class="coord"><input data-field="longitude" inputmode="decimal" placeholder="101.256742" /><em id="lng-hemi">E</em></span>
        <button type="button" class="ghost" id="btn-map">在地图上调整</button>
      </div>
      <span class="hint">支持粘贴「纬度, 经度」自动填入 · 南半球/西半球用负值（如 -33.9）· 精确坐标将随观察公开</span>
      <div id="map-box" hidden></div>
      <div class="row2" style="margin-top:16px">
        <div class="field"><input data-field="admin1" placeholder="省 / 州（云南 · 西双版纳…）" /></div>
        <div class="field"><input data-field="admin2" placeholder="市 / 县" /></div>
      </div>
      <div class="row2">
        <div class="field"><input data-field="locality" placeholder="乡镇 · 村 / 具体位置" /></div>
        <div class="field"><input data-field="site_name" placeholder="具体地点名（沟谷雨林林缘）" /></div>
      </div>
    </section>

    <section class="field ed-sec" id="sec-id">
      <h2 class="ed-sec-title">鉴定</h2>
      <div class="species-wrap" id="species-wrap">
        <input id="species-search" placeholder="搜索物种（学名 / 中文名），允许留空" autocomplete="off" />
        <div class="species-pop" id="species-pop"></div>
      </div>
      <div class="cn-row">
        <input id="species-cn" placeholder="中文名（选填，如「高居腹猎蛛」）" maxlength="60" disabled autocomplete="off" />
        <span class="hint" id="species-cn-hint">多数物种没有中文名，可留空；选定学名后可补，保存后显示在该物种页</span>
      </div>
      <div class="hint">不确定就留空，发布会记为 Salticidae sp.（跳蛛科未定种）；cf. / aff. / 工作编号都是合法状态</div>
    </section>

    <section class="field ed-sec" id="sec-note">
      <h2 class="ed-sec-title">野外笔记</h2>
      <textarea data-field="field_note" rows="3" placeholder="行为、生境、天气、微环境，或任何以后可能值得记住的细节。"></textarea>
      <span class="hint" id="exif-cam"></span>
    </section>

    <details class="more ed-sec" id="sec-more">
      <summary>更多记录信息</summary>
      <div class="grid">
        <div class="field"><label>性别</label><select data-field="sex"><option value="unknown">未知</option><option value="male">雄性</option><option value="female">雌性</option></select></div>
        <div class="field"><label>生命阶段</label><select data-field="life_stage"><option value="unknown">未知</option><option value="adult">成体</option><option value="subadult">亚成体</option><option value="juvenile">幼体</option></select></div>
        <div class="field"><label>数量</label><input type="number" data-field="count" min="1" /></div>
        <div class="field"><label>海拔（米）</label><input type="number" data-field="elevation_m" /></div>
        <div class="field"><label>微生境</label><input data-field="microhabitat" placeholder="叶片上表面" /></div>
        <div class="field"><label>所在植物</label><input data-field="plant" /></div>
        <div class="field"><label>天气</label><input data-field="weather" placeholder="雨后 / 晴…" /></div>
        <div class="field"><label>国家</label><input data-field="country_name" /></div>
      </div>
    </details>
  </main>

  <aside class="ed-rail" aria-label="进度">
    <nav class="rail-nav" id="rail-nav">
      <a href="#sec-photos" data-sec="photos">照片<i></i></a>
      <a href="#sec-time" data-sec="time">时间与地点<i></i></a>
      <a href="#sec-id" data-sec="id">鉴定<i></i></a>
      <a href="#sec-note" data-sec="note">野外笔记<i></i></a>
    </nav>
  </aside>
  </div>

  <div class="publish-done" id="publish-done" hidden>
    <div class="pd-box">
      <div class="pd-check">✓</div>
      <h2>已发布</h2>
      <div class="pd-id">${jsonForScript(publicId || '')}</div>
      <p>这条观察已经公开在红栏杆跳蛛观察志。</p>
      <div class="pd-actions">
        <a class="primary" href="${SITE_URL}/observations/${publicId || ''}/" target="_blank" rel="noopener">查看公开页面 ↗</a>
        <button type="button" class="ghost" id="pd-continue">继续编辑</button>
        <a class="ghost" href="/studio/observations/new">新建下一条观察</a>
      </div>
      <div class="pd-warn" id="pd-warn" hidden></div>
    </div>
  </div>

  <div class="bottombar">
    <span id="bar-status" style="font-size:12.5px;color:var(--faint)"></span>
    <span class="spacer"></span>
    <span class="pub-hint" id="pub-hint"${meta.status !== 'draft' ? ' hidden' : ''}>发布后将立即显示在主站</span>
    <div class="status-menu" id="status-menu" hidden>
      <button type="button" data-act="private">设为私密</button>
      <button type="button" data-act="archived">归档</button>
    </div>
    <button type="button" class="ghost" id="btn-more" hidden>⋯</button>
    <button type="button" class="ghost" id="btn-savedraft">保存草稿</button>
    <button type="button" class="primary" id="btn-publish">${meta.status === 'archived' ? '恢复为草稿' : meta.status === 'published' ? '保存修改' : '发布'}</button>
  </div>

  <script>
    window.__EDITOR_BOOT = {
      placeId: ${jsonForScript(data.placeId ?? null)},
      placeName: ${jsonForScript(data.placeName ?? '')},
      publicId: ${jsonForScript(publicId)},
      status: ${jsonForScript(meta.status)},
      hasUnpublished: ${jsonForScript(meta.hasUnpublished)},
      photoMeta: ${jsonForScript(meta.photoMeta)},
      tiandituKey: ${jsonForScript(meta.tiandituKey ?? '')},
      taxa: ${jsonForScript(taxaOptions)},
      data: ${jsonForScript({
        observed_at: data.observed_at ?? '',
        latitude: data.latitude ?? '',
        longitude: data.longitude ?? '',
        country_name: data.country_name ?? '中国',
        admin1: data.admin1 ?? '',
        admin2: data.admin2 ?? '',
        locality: data.locality ?? '',
        site_name: data.site_name ?? '',
        elevation_m: data.elevation_m ?? '',
        sex: data.sex ?? 'unknown',
        life_stage: data.life_stage ?? 'unknown',
        count: data.count ?? '',
        habitat: data.habitat ?? '',
        microhabitat: data.microhabitat ?? '',
        behavior: data.behavior ?? '',
        plant: data.plant ?? '',
        weather: data.weather ?? '',
        trip_slug: data.trip_slug ?? '',
        field_note: data.field_note ?? '',
        species_taxon_slug: data.species_taxon_slug ?? '',
      })},
    };
  </script>
  <script src="/studio-editor.js"></script>`, null, { editor: true, actions });
}

/** 类群管理（§21-§24 分类学变动流）：工作编号改名（slug 不变）与合并到正式类群/另一编号 */
export function importPage(user: StudioUser): string {
  const initial = user.display_name.slice(0, 1);
  return page('批量导入', `
  <div class="wrap wide">
    <div class="hello-wrap"><h1>批量导入</h1><p>把一整个野外批次拖进来：按拍摄时间自动分组，一组一条观察草稿。EXIF 时间与坐标在本机读取，照片只随草稿上传。</p></div>
    <div id="imp-drop" class="imp-drop">
      <span class="plus">＋</span>
      <b>拖入照片 / 文件夹，或点击选择</b><br/>
      <span class="hint">JPG / PNG · 支持 Ctrl+V 粘贴 · 最多 500 张</span>
    </div>
    <input type="file" id="imp-files" accept="image/jpeg,image/png" multiple hidden />
    <input type="file" id="imp-dir" webkitdirectory hidden />
    <div class="imp-toolbar" id="imp-toolbar" hidden>
      <span id="imp-count"></span>
      <label>分组间隔
        <select id="imp-thr">
          <option value="0.5">30 分钟</option>
          <option value="1">1 小时</option>
          <option value="2" selected>2 小时</option>
          <option value="6">6 小时</option>
          <option value="12">12 小时</option>
          <option value="24">24 小时</option>
        </select>
      </label>
      <button type="button" class="ghost" id="imp-reset" style="font:inherit;font-size:13px;background:none;border:none;color:var(--faint);cursor:pointer;text-decoration:underline;">清空重来</button>
      <span class="spacer"></span>
      <button type="button" class="primary" id="imp-create" disabled>创建草稿</button>
    </div>
    <div id="imp-status" class="hint" style="min-height:20px;"></div>
    <div class="imp-grid" id="imp-grid"></div>
    <div id="imp-done" class="imp-done"></div>
  </div>
  <script src="/studio-import.js"></script>`, user);
}

export function taxaManagePage(
  rows: { slug: string; scientific_name: string; chinese_name: string | null; status: string; usage: number }[],
  user: StudioUser,
): string {
  const staticOpts = TAXA.map((t) => `<option value="${esc(t.slug)}">${esc(t.scientific_name)}</option>`).join('');
  const rowsHtml = rows
    .map(
      (w) => `<div class="pm-row" data-slug="${esc(w.slug)}">
        <div class="pm-main">
          <b>${esc(w.scientific_name)}</b>${w.chinese_name ? `<span class="pm-sub">${esc(w.chinese_name)}</span>` : ''}
          <span class="pm-sub">${esc(w.slug)}（编号永久不变）</span>
        </div>
        <div class="pm-side"><span class="pm-count">${w.usage} 条当前鉴定</span>
          <input class="pm-target wt-name" data-slug="${esc(w.slug)}" value="${esc(w.scientific_name)}" title="改为新学名（编号不变）" />
          <button type="button" class="act-btn" data-rename="${esc(w.slug)}">改名</button>
          <select class="pm-target wt-target" data-slug="${esc(w.slug)}"><option value="">合并到…</option>${staticOpts}</select>
          <button type="button" class="act-btn" data-merge="${esc(w.slug)}">合并</button>
        </div>
      </div>`,
    )
    .join('');
  return page('类群管理', `
  <div class="wrap">
    <div class="hello-wrap"><h1>类群管理</h1>
    <p>分类学变动的收口处：研究确认后在这里改名或合并。<b>编号（slug）永久不变</b>——公开链接不会失效；改名只改显示名，合并会把当前鉴定整体迁到目标类群（鉴定历史保留原文）。正式类群的学名在仓库 taxa.json 里维护。</p></div>
    ${rows.length ? `<div class="place-manage">${rowsHtml}</div>` : '<p class="empty">还没有工作编号——在记录编辑器的物种框输入列表外的学名即可建立。</p>'}
  </div>
  <script>
  (function () {
    function post(url, body) {
      return fetch(url, { method: url.indexOf('/merge') !== -1 ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); });
    }
    Array.prototype.slice.call(document.querySelectorAll('button[data-rename]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var slug = b.getAttribute('data-rename');
        var input = document.querySelector('.wt-name[data-slug="' + slug + '"]');
        var name = (input ? input.value : '').trim();
        if (!name) { alert('先填新学名'); return; }
        b.disabled = true;
        post('/studio/api/taxa/' + slug, { scientific_name: name })
          .then(function (j) {
            if (j && j.ok) location.reload();
            else { b.disabled = false; alert((j && j.error) || '改名失败'); }
          })
          .catch(function () { b.disabled = false; alert('网络异常，请重试'); });
      });
    });
    Array.prototype.slice.call(document.querySelectorAll('button[data-merge]')).forEach(function (b) {
      b.addEventListener('click', function () {
        var slug = b.getAttribute('data-merge');
        var sel = document.querySelector('.wt-target[data-slug="' + slug + '"]');
        var to = sel ? sel.value : '';
        if (!to) { alert('先选择合并到的类群'); return; }
        if (!confirm('确定合并？该编号的当前鉴定会全部迁到目标类群（鉴定历史保留原文），此操作不可撤销。')) return;
        b.disabled = true;
        post('/studio/api/taxa/merge', { from: slug, to: to })
          .then(function (j) {
            if (j && j.ok) location.reload();
            else { b.disabled = false; alert((j && j.error) || '合并失败'); }
          })
          .catch(function () { b.disabled = false; alert('网络异常，请重试'); });
      });
    });
  })();
  </script>`, user);
}

// ---------- 札记编辑器（写作模式） ----------

/** 札记版式模板（与公开站 src/lib/noteTemplates.ts 一致） */
const NOTE_TEMPLATES: { id: string; name: string; desc: string }[] = [
  { id: 'classic', name: '经典', desc: '衬线长文，默认版式' },
  { id: 'folio', name: '双栏杂志', desc: '宽屏双栏 + 首字下沉' },
  { id: 'dropcap', name: '首字沉金', desc: '陶土红大写首字' },
  { id: 'marginalia', name: '旁注批言', desc: '引文浮动为旁注' },
  { id: 'gallery', name: '画册', desc: '通栏大图，图为主角' },
  { id: 'field', name: '野外手记', desc: '横线稿纸底 + 等宽小节' },
  { id: 'bigtype', name: '大字报', desc: '巨型标题 + 编号小节' },
  { id: 'quiet', name: '留白', desc: '窄栏居中极简' },
  { id: 'inversa', name: '夜刊', desc: '墨底纸字反色卡' },
  { id: 'tiba', name: '题跋', desc: '巨型引号题头' },
];

export function noteEditorHtml(slug: string | null, data: Record<string, any>): string {
  const published = data.status === 'published';
  const actions = `
    <div class="seg" id="note-seg"><button type="button" class="on" data-view="edit">写作</button><button type="button" data-view="preview">预览</button></div>
    <button type="button" class="ghost" id="btn-settings">设置</button>`;
  return page(slug ? `编辑：${data.title ?? slug}` : '写一篇野外笔记', `
  <main class="write-main split">
    <div id="pane-edit">
      <div class="nb-toolbar" id="nb-toolbar" role="toolbar" aria-label="格式工具栏">
        <button type="button" data-cmd="h2" title="小节标题">H2</button>
        <button type="button" data-cmd="h3" title="小标题">H3</button>
        <button type="button" data-cmd="bold" title="加粗"><b>B</b></button>
        <button type="button" data-cmd="quote" title="引用">❝</button>
        <button type="button" data-cmd="ul" title="列表">•≡</button>
        <button type="button" data-cmd="hr" title="分隔线">—</button>
        <span class="sep" aria-hidden="true"></span>
        <button type="button" data-cmd="image" title="插入图片">插图</button>
        <button type="button" data-cmd="obs" title="插入观察卡片">观察</button>
      </div>
      <div class="tpl-picker" id="tpl-picker" role="radiogroup" aria-label="版式模板">
        ${NOTE_TEMPLATES.map((t) => `<button type="button" class="tpl-opt${(data.template ?? 'classic') === t.id ? ' on' : ''}" data-tpl="${t.id}" title="${t.desc}"><b>${t.name}</b><span>${t.desc}</span></button>`).join('')}
      </div>
      <input id="n-title" class="title-line" placeholder="标题" value="${esc(data.title ?? '')}" autocomplete="off" />
      <input id="n-subtitle" class="subtitle-line" placeholder="副标题（可选）" value="${esc(data.subtitle ?? '')}" autocomplete="off" />
      <textarea id="n-body" class="body-line" placeholder="从这里开始写……">${esc(data.body_md ?? '')}</textarea>
    </div>
    <div id="pane-preview" class="article-body preview-pane" hidden>
      <span class="preview-label">实 时 排 版</span>
      <h1 class="pv-title"></h1>
      <p class="pv-sub"></p>
      <div class="pv-body"></div>
    </div>
  </main>

  <button type="button" class="fab-add" id="fab-add" title="插入（也可用 / 呼出）">＋</button>
  <div class="block-menu" id="block-menu">
    <button type="button" data-ins="## ">小节标题 H2</button>
    <button type="button" data-ins="### ">小标题 H3</button>
    <button type="button" data-ins="&gt; ">引用</button>
    <button type="button" data-ins="- ">列表</button>
    <div class="sep"></div>
    <button type="button" data-ins="__IMAGE__">图片…</button>
    <button type="button" data-ins="__OBS__">观察卡片…</button>
    <button type="button" data-ins="__TRIP__">调查链接…</button>
    <div class="sep"></div>
    <button type="button" data-ins="---">分隔线</button>
  </div>

  <div class="drawer-mask" id="drawer-mask"></div>
  <aside class="drawer" id="drawer">
    <h3>文章设置</h3>
    <div class="ro"><b>链接</b><span>${slug ? esc(`/posts/${slug}/`) : '发布后生成'}</span></div>
    <div class="ro"><b>作者</b><span>${esc(data.author_name ?? '')}</span></div>
    <div class="field"><label>关联观察</label><div style="display:flex;gap:8px;align-items:center;"><input id="n-related" placeholder="SFN-…（可手输，或点「选」搜索）" value="${esc(data.related ?? '')}" style="flex:1;min-width:0;" /><button type="button" class="ghost" id="n-related-pick" style="font:inherit;font-size:12.5px;white-space:nowrap;">选观察</button></div></div>
  </aside>

  <div class="bottombar">
    <span id="bar-status" style="font-size:12.5px;color:var(--faint)"></span>
    <span class="spacer"></span>
    <button type="button" class="ghost" id="btn-preview2">预 览</button>
    <button type="button" class="primary" id="btn-publish-note">${published ? '保存修改' : '发布'}</button>
  </div>

  <input type="hidden" id="n-slug" value="${esc(slug ?? '')}" />
  <script>
    window.__NOTE_BOOT = {
      slug: ${jsonForScript(slug ?? null)},
      bodyMd: ${jsonForScript(data.body_md ?? '')},
      status: ${jsonForScript(data.status ?? 'draft')},
      template: ${jsonForScript(data.template ?? 'classic')},
    };
  </script>
  <script src="/studio-note-editor.js"></script>`, null, { editor: true, actions });
}


