// Studio 远程版端到端验证（对本地 studio/scripts/e2e-v1.mts 的移植）。
// 前置：`wrangler dev --port 4333`（本地 D1/R2 模拟）+ fixtures。
// 运行：npx tsx scripts/e2e-remote.mts <wrangler日志路径>
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';
import sharp from 'sharp';
import { unzipSync } from 'fflate';

const ROOT = process.cwd(); // studio-remote/
const BASE = 'http://127.0.0.1:4344';
const LOG = process.argv[2] ?? '';
const EMAIL = 'yangzy0124@gmail.com';

const failures: string[] = [];
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? '✓' : '✗'} ${label}`);
  if (!cond) failures.push(label);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let cookie = '';
async function req(path: string, opts: any = {}): Promise<Response> {
  // wrangler dev 本地偶发连接抖动（热重载/workerd 重启）：仅对传输层错误重试
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        ...opts,
        headers: { ...(opts.headers ?? {}), ...(cookie ? { Cookie: cookie } : {}) },
      });
      for (const c of (res.headers as any).getSetCookie?.() ?? []) {
        const kv = String(c).split(';')[0];
        if (kv.startsWith('studio_session=')) cookie = kv;
      }
      return res;
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.cause?.code ?? e?.code ?? e);
      if (!/ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|HEADERS_TIMEOUT/.test(msg)) throw e;
      await sleep(1500);
    }
  }
  throw lastErr;
}

// 浏览器端 canvas 派生图的本地等价物（sharp 生成同样的分组字段）
async function preparedUpload(file: Buffer, name: string) {
  const img = sharp(file);
  const meta = await img.metadata();
  const width = meta.width!;
  const height = meta.height!;
  const variants: { name: string; blob: Blob }[] = [];
  for (const w of [480, 768, 1280, 1920].filter((x) => x <= width)) {
    const bufJ = await sharp(file).resize({ width: w }).jpeg({ quality: 82 }).toBuffer();
    variants.push({ name: `${w}.jpg`, blob: new Blob([bufJ], { type: 'image/jpeg' }) });
    const bufW = await sharp(file).resize({ width: w }).webp({ quality: 72 }).toBuffer();
    variants.push({ name: `${w}.webp`, blob: new Blob([bufW], { type: 'image/webp' }) });
  }
  return {
    original: new File([file], name, { type: 'image/jpeg' }),
    width,
    height,
    variants,
  };
}

function appendUpload(fd: FormData, p: Awaited<ReturnType<typeof preparedUpload>>) {
  fd.append('original', p.original, p.original.name);
  fd.append('width', String(p.width));
  fd.append('height', String(p.height));
  for (const v of p.variants) fd.append('variant', v.blob, v.name);
}

function d1(sql: string): any[] {
  const out = execSync(
    `npx wrangler d1 execute salticid-studio --local --json --command "${sql.replace(/"/g, '\\"')}"`,
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const parsed = JSON.parse(out);
  return parsed?.[0]?.results ?? [];
}

// ---------- 登录（受邀邮箱 OTP；wrangler dev 控制台读取验证码） ----------
await req('/studio/login/otp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `email=${encodeURIComponent(EMAIL)}`,
});
await sleep(500);
// 验证码优先从 D1 读取（与邮件投递解耦——Resend 发送成功时控制台不打印）；
// wrangler CLI 与 dev server 是两个连接，写入可见性偶有延迟，轮询兜底
let code = '';
for (let i = 0; i < 16 && !code; i++) {
  const rows = d1(`SELECT code FROM otp_codes WHERE lower(email) = '${EMAIL}' ORDER BY created_at DESC, id DESC LIMIT 1`);
  if (rows[0]?.code) code = String(rows[0].code);
  else await sleep(800);
}
if (!code) {
  const log = readFileSync(LOG, 'utf8');
  const codes = [...log.matchAll(new RegExp(`${EMAIL} 的登录验证码：(\\d{6})`, 'g'))].map((m) => m[1]);
  code = codes[codes.length - 1] ?? '';
}
ok(/^\d{6}$/.test(code ?? ''), `A0 登录：取得验证码（${code}）`);
const vres = await req('/studio/login/verify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `email=${encodeURIComponent(EMAIL)}&code=${code}`,
  redirect: 'manual',
});
ok(vres.status === 302 && cookie.includes('studio_session='), 'A0 登录：OTP 校验通过并获得会话');

// ---------- 场景 A ----------
const gpsBuf = readFileSync(resolve(ROOT, 'fixtures/e2e-src-gps.jpg'));
const nogpsBuf = readFileSync(resolve(ROOT, 'fixtures/e2e-src-nogps.jpg'));

const fd0 = new FormData();
fd0.append('photo', new File([gpsBuf], 'gps.jpg', { type: 'image/jpeg' }));
const xj = await (await req('/studio/api/exif-preview', { method: 'POST', body: fd0 })).json();
const x = xj.results?.[0];
ok(x?.date === '2026-09-07' && x?.gps?.lat != null, `A1 EXIF 预读：date=${x?.date} gps=${x?.gps?.lat},${x?.gps?.lng}`);

const cj = await (await req('/studio/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
ok(/^SFN-\d{4}-\d{6}$/.test(cj.public_id ?? ''), `A2 新建记录：${cj.public_id}`);
const pidA = cj.public_id;

const patch = await (await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    observed_at: x.date, latitude: x.gps.lat, longitude: x.gps.lng,
    country_name: '中国', admin1: '广东省', admin2: '惠州市', locality: '罗浮山', site_name: '山径林缘',
    elevation_m: '620', microhabitat: '林缘叶面', behavior: '游猎', weather: '晴',
    field_note: '成体雄蛛，远程 E2E 样本。', species_taxon_slug: 'salticidae',
  }),
})).json();
ok(patch.ok === true, 'A3 autosave：字段与鉴定已保存');

// 回归：空 field_note / 空 observed_at 不应触发 NOT NULL 约束 500
const patchEmpty = await (await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ field_note: '', locality: '', elevation_m: '', sex: '' }),
})).json();
ok(patchEmpty.ok === true, `A3b 空串字段（field_note/locality/elevation/sex）保存不 500`);

const upA = new FormData();
appendUpload(upA, await preparedUpload(gpsBuf, 'a1.jpg'));
const upAres = await req(`/studio/observations/${pidA}/photos`, { method: 'POST', body: upA });
const upAtext = await upAres.text();
let upAj: any = {};
try { upAj = JSON.parse(upAtext); } catch {}
ok(upAres.ok && upAj.added?.length === 1, `A4 照片上传：${upAres.ok ? upAj.added?.[0] : upAtext.slice(0, 120)}`);

const pj = await (await req(`/studio/api/observations/${pidA}/publish`, { method: 'POST' })).json();
ok(pj.ok === true, `A5 发布：${pj.public_url ?? pj.error}`);

const expRes = await req('/studio/export');
ok(expRes.ok && (expRes.headers.get('content-type') ?? '').includes('zip'), 'A6 导出：zip 包可下载');
const zipBuf = new Uint8Array(await expRes.arrayBuffer());
const zip = unzipSync(zipBuf);
ok(['studio-observations.json', 'studio-locations.json', 'studio-media.json', 'studio-identifications.json', 'studio-posts.json', 'README.txt'].every((f) => f in zip), 'A6 导出：五个 JSON 与说明齐全');
const aObs = JSON.parse(new TextDecoder().decode(zip['studio-observations.json'])).find((o: any) => o.public_id === pidA);
const aLoc = JSON.parse(new TextDecoder().decode(zip['studio-locations.json'])).find((l: any) => l.id === aObs?.location_id);
ok(aObs && aLoc && Math.abs(aLoc.latitude - x.gps.lat) < 1e-6, `A7 导出坐标公开：${aLoc?.latitude},${aLoc?.longitude}`);
const aIdn = JSON.parse(new TextDecoder().decode(zip['studio-identifications.json']));
ok(aIdn[0]?.taxon_id === 'tax-salticidae', 'A7 导出鉴定：taxon_id 已映射');
ok(Object.keys(zip).some((k) => k.startsWith('originals/SN-') || k.startsWith('originals/SFN-M-')), 'A6 导出：原图已打包');

// R2 派生图可读（Studio 内部路由）
const der = await req(`/media/derivatives/${upAj.added?.[0]}-480.jpg`);
ok(der.ok && (der.headers.get('content-type') ?? '').includes('image/jpeg'), 'A8 R2 派生图可访问');

// ---------- 场景 B ----------
const pidB = (await (await req('/studio/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).public_id;
const upB = new FormData();
appendUpload(upB, await preparedUpload(nogpsBuf, 'b1.jpg'));
await req(`/studio/observations/${pidB}/photos`, { method: 'POST', body: upB });
await req(`/studio/api/observations/${pidB}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ observed_at: '2026-09-06', field_note: '阴天，溪边巨石背面，一只亚成体。' }),
});
const bp1 = await (await req(`/studio/api/observations/${pidB}/publish`, { method: 'POST' })).json();
ok(bp1.ok !== true && String(bp1.error).includes('坐标'), `B1 发布拦截：${bp1.error}`);
const bp2 = await (await req(`/studio/api/observations/${pidB}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ latitude: '23.657200', longitude: '113.921600', admin1: '广东省', admin2: '龙门县', locality: '南昆山' }),
})).json();
const bp3 = await (await req(`/studio/api/observations/${pidB}/publish`, { method: 'POST' })).json();
ok(bp2.ok && bp3.ok === true, `B2 手动坐标后发布成功：${bp3.public_url ?? bp3.error}`);

// ---------- 场景 C ----------
const pidC = (await (await req('/studio/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json()).public_id;
const upC = new FormData();
for (const n of ['gps', 'nogps', 'gps', 'nogps', 'gps'] as const) {
  appendUpload(upC, await preparedUpload(n === 'gps' ? gpsBuf : nogpsBuf, `${n}.jpg`));
}
const upCres = await req(`/studio/observations/${pidC}/photos`, { method: 'POST', body: upC });
const upCtext = await upCres.text();
let upCj: any = {};
try { upCj = JSON.parse(upCtext); } catch {}
const cids: string[] = upCj.added ?? [];
ok(cids.length === 5, `C1 五张照片上传：${cids.join(',')}`);
const third = cids[2];
const oc = await (await req(`/studio/api/observations/${pidC}/photos/order`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ order: [third, ...cids.filter((p) => p !== third)] }),
})).json();
const coverRow = d1(`SELECT public_id FROM media WHERE observation_id = (SELECT id FROM observations WHERE public_id = '${pidC}') AND is_cover = 1`);
ok(oc.ok && coverRow[0]?.public_id === third, `C2 排序后第 3 张成为封面：${coverRow[0]?.public_id}`);
await req(`/studio/api/observations/${pidC}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ observed_at: '2026-09-07', latitude: '23.051944', longitude: '113.125', admin1: '广东省', admin2: '惠州市', locality: '罗浮山' }),
});
const cp = await (await req(`/studio/api/observations/${pidC}/publish`, { method: 'POST' })).json();
ok(cp.ok === true, `C3 排序后发布：${cp.public_url ?? cp.error}`);

// ---------- 场景 D ----------
// 札记独立插图（不挂观察）：走 /studio/api/media/upload
const upN = new FormData();
appendUpload(upN, await preparedUpload(nogpsBuf, 'd1.jpg'));
const upNj = await (await req('/studio/api/media/upload', { method: 'POST', body: upN })).json();
const noteImgId: string = upNj.public_id ?? '';
ok(upNj.ok === true && /^SN-\d{4}-\d{5}$/.test(noteImgId), `D0 札记插图独立上传：${noteImgId}`);

const bodyMd = [
  '## 山径上的半小时',
  '',
  '雨后初晴，叶片上的游猎者格外活跃。',
  '',
  `![独立插图](media:${noteImgId})`,
  '',
  `![封面图注](media:${cids[0]})`,
  '',
  `![第二张图注](media:${cids[1]})`,
  '',
  `{{observation:${pidA}}}`,
  '',
  '> 野外观感，仅供参考。',
].join('\n');
const nd = await (await req('/studio/api/notes', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '雨后山径半小时', subtitle: '从沟谷到山脊，找一只翠蛛', body_md: bodyMd }),
})).json();
ok(!!nd.slug, `D1 札记创建：${nd.slug}`);
const nr = await (await req(`/studio/api/notes/${nd.slug}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: '雨后山径半小时', subtitle: '从沟谷到山脊，找一只翠蛛', body_md: bodyMd,
    related_observation_public_ids: `${pidA}, junk, ${pidB}`,
  }),
})).json();
ok(nr.ok === true, 'D2 关联观察字段已保存（含非法编号过滤）');
const pv = await (await req('/studio/api/notes/preview', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body_md: bodyMd }),
})).json();
ok(typeof pv.html === 'string' && pv.html.includes('amg-triptych'), 'D3 预览：三张连续图组成三联（amg-triptych）');
ok(pv.html.includes('embed-observation') && pv.html.includes(pidA), 'D3 预览：观察嵌入渲染为卡片');
const np = await (await req(`/studio/api/notes/${nd.slug}/publish`, { method: 'POST' })).json();
ok(np.ok === true, `D4 札记发布：${np.public_url ?? np.error}`);

// 二次导出：post 字段与札记独立插图必须完整进包（公开站构建依赖）
const exp2 = await req('/studio/export');
ok(exp2.ok, 'D5 二次导出：zip 可下载');
const zip2 = unzipSync(new Uint8Array(await exp2.arrayBuffer()));
const posts2 = JSON.parse(new TextDecoder().decode(zip2['studio-posts.json'])) as any[];
const p0 = posts2.find((p) => p.slug === nd.slug);
ok(!!p0 && Array.isArray(p0.related_observation_public_ids) && p0.related_observation_public_ids.join(',') === [pidA, pidB].join(','), `D5 导出关联观察：${p0?.related_observation_public_ids}`);
ok(!!p0 && 'cover_media_public_id' in p0, 'D5 导出封面字段存在（cover_media_public_id）');
const media2 = JSON.parse(new TextDecoder().decode(zip2['studio-media.json'])) as any[];
const noteMedia = media2.find((m) => m.public_id === noteImgId);
ok(!!noteMedia && noteMedia.observation_id === null, 'D6 导出札记独立插图（observation_id = null）');
ok(Object.keys(zip2).includes(`originals/${noteImgId}.jpg`), 'D6 札记插图原图已打包');
ok(!!p0 && String(p0.body_html).includes(`/media/derivatives/${noteImgId}-`), 'D6 正文引用公开派生图路径');

// ---------- 场景 G：状态机（发布=立即公开；私密/归档不公开；published_at 不可变） ----------
// A 场景已发布 pidA：记录首次 published_at
const pa1 = d1(`SELECT published_at FROM observations WHERE public_id = '${pidA}'`)[0]?.published_at;
ok(!!pa1, `G0 已发布记录有 published_at（${pa1}）`);
// 保存修改（explicit PATCH）不得改变 published_at
await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ field_note: 'G 场景：保存修改不改变发布时间。', explicit: true }),
});
const pa2 = d1(`SELECT published_at FROM observations WHERE public_id = '${pidA}'`)[0]?.published_at;
ok(pa2 === pa1, `G1 保存修改后 published_at 不变`);

// 设为私密 → 立即退出导出（公开站下线）
await req(`/studio/api/observations/${pidA}/private`, { method: 'POST' });
const privRow = d1(`SELECT status, visibility FROM observations WHERE public_id = '${pidA}'`)[0];
ok(privRow.status === 'private' && privRow.visibility === 'private', `G2 设为私密：status/visibility 一致`);
const expPriv = await req('/studio/export');
const zipPriv = unzipSync(new Uint8Array(await expPriv.arrayBuffer()));
const privObs = JSON.parse(new TextDecoder().decode(zipPriv['studio-observations.json'])) as any[];
ok(!privObs.some((o) => o.public_id === pidA), `G3 私密记录不进入公开导出`);

// 再次发布 → 重新公开，且 published_at 保持首次值
const repub = await (await req(`/studio/api/observations/${pidA}/publish`, { method: 'POST' })).json();
const pa3 = d1(`SELECT published_at FROM observations WHERE public_id = '${pidA}'`)[0]?.published_at;
ok(repub.ok === true && pa3 === pa1, `G4 私密→发布：重新公开且 published_at 保持首次值`);

// 归档 → 退出公开；恢复为草稿 → 不公开
await req(`/studio/api/observations/${pidA}/archive`, { method: 'POST' });
const archRow = d1(`SELECT status, visibility FROM observations WHERE public_id = '${pidA}'`)[0];
ok(archRow.status === 'archived' && archRow.visibility === 'private', `G5 归档：status/visibility 一致`);
const expArch = await req('/studio/export');
const zipArch = unzipSync(new Uint8Array(await expArch.arrayBuffer()));
const archObs = JSON.parse(new TextDecoder().decode(zipArch['studio-observations.json'])) as any[];
ok(!archObs.some((o) => o.public_id === pidA), `G6 已归档记录不进入公开导出`);
await req(`/studio/api/observations/${pidA}/restore`, { method: 'POST' });
const restored = d1(`SELECT status FROM observations WHERE public_id = '${pidA}'`)[0]?.status;
ok(restored === 'draft', `G7 恢复为草稿`);
// 恢复后重新发布，保持编号与公开状态（F1 依赖 pidA 为 published）
const repub2 = await (await req(`/studio/api/observations/${pidA}/publish`, { method: 'POST' })).json();
ok(repub2.ok === true, `G8 恢复后重新发布`);

// 列表页四状态分区（草稿/已发布/私密/已归档）
const draftsPage = await (await req('/studio/drafts')).text();
ok(
  ['草稿', '已发布', '私密', '已归档'].every((k) => draftsPage.includes(k)),
  `G9 列表页四状态分区齐全`,
);

// ---------- 场景 H：地点实体（搜索 / 新建 / 挂接 / 合并 / 质量页） ----------
const searchRes = await (await req('/studio/api/places?q=' + encodeURIComponent('罗浮山'))).json();
ok(Array.isArray(searchRes.places) && searchRes.places.length >= 1, `H1 地点搜索：${JSON.stringify(searchRes.places?.map((x: any) => x.name) ?? [])}`);

const newPlace = await (await req('/studio/api/places', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '南昆山', country: '中国', admin1: '广东省', admin2: '惠州市', locality: '南昆山', site_name: 'E2E 测试点', latitude: 23.65, longitude: 113.92, elevation_m: 800 }),
})).json();
ok(newPlace.duplicate === true && newPlace.existing?.id, `H2 新建地点触发去重提示（已存在 id=${newPlace.existing?.id}）`);

const dupB = await (await req('/studio/api/places', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'E2E 测试地点甲', country: '中国', admin1: '广东省', admin2: '惠州市', locality: '南昆山' }),
})).json();
const testPlaceId = dupB.place?.id ?? dupB.existing?.id;
ok((dupB.ok === true && dupB.place?.id) || dupB.duplicate === true, `H3 新建地点（重复时返回已有）：id=${testPlaceId}`);

const attach = await (await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ place_id: testPlaceId, explicit: true }),
})).json();
ok(attach.ok === true, `H4 观察挂接地点`);

const badAttach = await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ place_id: 999999 }),
});
ok(badAttach.status === 400, `H5 挂接不存在的地点被拒绝（400）`);

const qpage = await req('/studio/quality');
ok(qpage.status === 200, `H6 数据质量页可访问`);
const mpPage = await req('/studio/places-manage');
ok(mpPage.status === 200, `H7 地点管理页可访问`);

const expPlaces = await req('/studio/export');
const zipPlaces = unzipSync(new Uint8Array(await expPlaces.arrayBuffer()));
ok(files_in(zipPlaces, 'studio-places.json'), `H8 导出包含 studio-places.json`);
const placesJson = JSON.parse(new TextDecoder().decode(zipPlaces['studio-places.json']));
ok(placesJson.some((p: any) => p.name === 'E2E 测试地点甲'), `H9 新建地点已导出`);

// 合并：E2E 测试地点甲 → 罗浮山
const luofushan = placesJson.find((p: any) => p.name === '罗浮山');
const merge = await (await req('/studio/api/places/merge', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: testPlaceId, to: Number(luofushan.id.replace('place-', '')) }),
})).json();
ok(merge.ok === true, `H10 地点合并成功`);
const mergedRow = d1(`SELECT place_id FROM observations WHERE public_id = '${pidA}'`)[0]?.place_id;
ok(mergedRow === Number(luofushan.id.replace('place-', '')), `H11 合并后观察迁移到罗浮山`);

// ---------- 场景 T：工作编号（建立 / 复用 / 重名拒绝 / 鉴定引用 / 导出） ----------
const wtRes = await (await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Rhene cf. flavigera' }),
})).json();
ok(wtRes.ok === true && wtRes.taxon?.slug === 'rhene-cf-flavigera', `T1 建立工作编号：${wtRes.taxon?.slug}`);

const wtRe = await (await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Rhene cf. flavigera' }),
})).json();
ok(wtRe.ok === true && wtRe.created === false, `T2 重复建立复用既有编号（created=false）`);

const wtDup = await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Siler cupreus' }),
});
ok(wtDup.status === 409, `T3 与正式类群重名被拒绝（409）`);

const wtBad = await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: '123 三号' }),
});
ok(wtBad.status === 400, `T4 非法名称被拒绝（400）`);

// 鉴定引用工作编号：以编辑器 boot 数据为准（与真实编辑流一致，不依赖 d1 CLI 读取时序）
async function editorSlug(pid: string): Promise<string> {
  const html = await (await req(`/studio/observations/${pid}/edit`)).text();
  return html.match(/"species_taxon_slug":"([^"]*)"/)?.[1] ?? '';
}
const idn0 = await editorSlug(pidA);
const wtIdn = await (await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ species_taxon_slug: 'rhene-cf-flavigera', explicit: true }),
})).json();
const wtDisplay = await editorSlug(pidA);
ok(wtIdn.ok === true && wtDisplay === 'rhene-cf-flavigera', `T5 鉴定引用工作编号（editor slug=${wtDisplay}）`);

const expT = await req('/studio/export');
const zipT = unzipSync(new Uint8Array(await expT.arrayBuffer()));
const taxaJsonT = JSON.parse(new TextDecoder().decode(zipT['studio-taxa.json'] ?? new Uint8Array()));
ok(files_in(zipT, 'studio-taxa.json') && taxaJsonT.some((t: any) => t.slug === 'rhene-cf-flavigera' && t.status === 'working'), `T6 导出包含 studio-taxa.json 工作编号`);

// 还原 pidA 鉴定，并以编辑器视图确认写回
if (idn0 && idn0 !== 'rhene-cf-flavigera') {
  await req(`/studio/api/observations/${pidA}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ species_taxon_slug: idn0, explicit: true }),
  });
  ok((await editorSlug(pidA)) === idn0, `T7 鉴定还原为 ${idn0}`);
}

function files_in(z: Record<string, Uint8Array>, name: string): boolean {
  return name in z;
}

// ---------- 场景 U：分类学变动流（改名 / 合并 / 导出跟随） ----------
// 每次运行用唯一后缀，避免上一轮 merged 状态污染（同名编号不可复用）
const uq = Math.random().toString(36).slice(2, 7).replace(/[0-9]/g, function (d) { return 'abcdefghij'[+d]; }); // 学名仅允许字母
const uName1 = 'Plexippus aff. minor ' + uq;
const uName2 = 'Plexippus aff. buttikeri ' + uq;
const uSlug = 'plexippus-aff-minor-' + uq;
async function d1poll(sql, tries = 10) {
  for (let i = 0; i < tries; i++) {
    const rows = d1(sql);
    if (rows.length) return rows;
    await sleep(500);
  }
  return [];
}
const uCreate = await (await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: uName1 }),
})).json();
ok(uCreate.ok === true && uCreate.taxon?.slug === uSlug, `U1 建立工作编号 ${uSlug}`);

await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ species_taxon_slug: uSlug, explicit: true }),
});
const uRename = await (await req(`/studio/api/taxa/${uSlug}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ scientific_name: uName2 }),
})).json();
const uD1 = await d1poll(`SELECT display_identification FROM identifications WHERE taxon_slug = '${uSlug}' AND is_current = 1`);
ok(uRename.ok === true, `U2 改名成功（slug 不变、编号永久）`);
ok((uD1[0]?.display_identification ?? '') === uName2, `U3 当前鉴定 display 已刷新（${uD1[0]?.display_identification}）`);

const uMerge = await (await req('/studio/api/taxa/merge', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: uSlug, to: 'plexippus-paykulli' }),
})).json();
const obsRowId = d1(`SELECT id FROM observations WHERE public_id = '${pidA}'`)[0]?.id ?? 0;
const uAfter = await d1poll(`SELECT taxon_slug, display_identification FROM identifications WHERE observation_id = ${obsRowId} AND is_current = 1`);
ok(uMerge.ok === true && uMerge.moved >= 1, `U4 合并到正式类群（迁入 ${uMerge.moved} 条当前鉴定）`);
ok(uAfter[0]?.taxon_slug === 'plexippus-paykulli' && uAfter[0]?.display_identification === 'Plexippus paykulli', `U5 合并后鉴定指向 Plexippus paykulli（${uAfter[0]?.display_identification}）`);
// 合并是「同一类群的改名」，不伪造新的鉴定事件；痕迹留在审计与修订
const uAudit = await d1poll(`SELECT action FROM audit_logs WHERE entity_type = 'taxon' AND action = 'working-taxon.merged' AND entity_id = '${uSlug}'`);
ok(uAudit.length >= 1, `U6 合并写入审计`);
const uMergedGone = d1(`SELECT status FROM working_taxa WHERE slug = '${uSlug}'`);
ok(uMergedGone[0]?.status === 'merged', `U7 来源编号标记 merged`);
const expU = await req('/studio/export');
const zipU = unzipSync(new Uint8Array(await expU.arrayBuffer()));
const taxaU = JSON.parse(new TextDecoder().decode(zipU['studio-taxa.json'] ?? new Uint8Array()));
ok(!taxaU.some((t: any) => t.slug === uSlug), `U8 导出不再包含已合并编号`);

// 还原 pidA 鉴定
await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ species_taxon_slug: 'salticidae', explicit: true }),
});

// ---------- 场景 V：WSC 学名校验（假属名拦截 / 假种名建议 sp） ----------
const vTaxon = await (await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Zzqxvus fakeus' }),
})).json();
ok(vTaxon.ok === true, `V1 建立测试用假属工作编号（${vTaxon.taxon?.slug}）`);

// 造一条满足其余发布条件的记录：借用 pidB 的照片（复制上传参数不必需——pidB 已有图，直接改 pidB 鉴定再发布其副本）
// 简化：把 pidB 的鉴定临时改为假属名，尝试重新发布已发布记录不受影响——发布拦截只在 publish 动作触发，
// 因此新建一条草稿并走完整发布
const vObs = await (await req('/studio/api/observations', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
})).json();
const vPid = vObs.public_id;
await req(`/studio/api/observations/${vPid}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ observed_at: '2026-09-12', latitude: 14.2, longitude: 104.8, country_name: '泰国', admin1: '素林府', field_note: 'WSC 校验场景。', explicit: true }),
});
// 照片：复用 pidB 的第一张原图 buffer 重新上传
const fdV = new FormData();
const buf2 = readFileSync(resolve(ROOT, 'fixtures/e2e-src-nogps.jpg'));
const p2b = await preparedUpload(buf2);
appendUpload(fdV, p2b);
const vUp = await (await req(`/studio/observations/${vPid}/photos`, { method: 'POST', body: fdV })).json();
ok((vUp.added ?? []).length === 1, `V2 校验场景照片上传`);

await req(`/studio/api/observations/${vPid}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ species_taxon_slug: vTaxon.taxon.slug, explicit: true }),
});
const vBlock = await req(`/studio/api/observations/${vPid}/publish`, { method: 'POST' });
ok(vBlock.status === 400, `V3 WSC 无此属名 → 发布被拦截（400）`);
const vBlockBody = await vBlock.json().catch(() => ({}));
ok(String(vBlockBody.error ?? '').includes('WSC'), `V4 拦截文案说明 WSC 原因`);

// 改成真属+假种：放行但给警告
const vTaxon2 = await (await req('/studio/api/taxa', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Siler fakeus' }),
})).json();
await req(`/studio/api/observations/${vPid}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ species_taxon_slug: vTaxon2.taxon.slug, explicit: true }),
});
const vWarn = await (await req(`/studio/api/observations/${vPid}/publish`, { method: 'POST' })).json();
ok(vWarn.ok === true && Array.isArray(vWarn.warnings) && vWarn.warnings.some((w: string) => w.includes('sp.')), `V5 真属假种 → 发布放行 + 建议降级 sp`);

// 清理：归档测试记录
await req(`/studio/api/observations/${vPid}/archive`, { method: 'POST' });


await req(`/studio/api/observations/${pidA}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ field_note: '编辑复核：补充生境描述（发布后修订）。' }),
});
const revs = d1(`SELECT COUNT(*) AS c FROM revisions WHERE entity_type = 'observation' AND entity_id = '${pidA}'`);
const audits = d1(`SELECT COUNT(*) AS c FROM audit_logs WHERE entity_id = '${pidA}'`);
ok((revs[0]?.c ?? 0) >= 1 && (audits[0]?.c ?? 0) >= 1, `F1 编号不变、修订 ${revs[0]?.c} 条、审计 ${audits[0]?.c} 条`);

// ---------- 场景 E：编辑器脚本语法体检（防「整体解析失败」类回归） ----------
for (const scriptPath of ['/studio-editor.js', '/studio-note-editor.js', '/studio-profile.js']) {
  const res = await fetchRetry(BASE + scriptPath, {});
  const src = await res.text();
  let parseOk = true;
  try { new Function(src); } catch { parseOk = false; }
  ok(res.status === 200 && parseOk, `E1 编辑器脚本可解析：${scriptPath}`);
}

// 未登录防护（wrangler dev 偶发连接抖动，重试两次）
async function fetchRetry(url: string, opts: any = {}): Promise<Response> {
  let err: unknown;
  for (let i = 0; i < 3; i++) {
    try { return await fetch(url, opts); } catch (e) { err = e; await sleep(1500); }
  }
  throw err;
}
cookie = '';
const anon = await fetchRetry(BASE + '/studio', { redirect: 'manual' });
ok(anon.status === 302, 'S1 未登录访问 /studio 重定向到登录页');
const anonApi = await fetchRetry(BASE + '/studio/api/observations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
ok(anonApi.status === 401, 'S2 未登录 API 返回 401');

writeFileSync(resolve(ROOT, '.e2e-manifest.json'), JSON.stringify({ pidA, pidB, pidC, cids, note: nd.slug }, null, 2));
console.log(failures.length ? `\nE2E 失败 ${failures.length} 项` : '\nE2E 全部通过（远程版场景 A/B/C/D/H/T/U/V/F + 安全探测）');
process.exit(failures.length ? 1 : 0);
