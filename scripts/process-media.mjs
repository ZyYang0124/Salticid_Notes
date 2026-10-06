// 媒体派生管线 v2（SOP Fluidity §5/§63/§64）：
//   - 每张公开图生成多宽度（480/768/1280/1920，≤ 原图）× AVIF/WebP/JPEG
//   - 保留传统 thumb/medium/large JPG（旧引用兼容 + 灯箱大图）
//   - 全部重编码剥离 EXIF（规则 21），原图只读永不修改（规则 20）
// 产物：public/media/derivatives/*  +  src/data/generated/media-manifest.json（构建期导入）

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 生成到 public/ 下，Astro 构建时原样拷贝进 dist（原图永不出现在公开输出）
const DERIV_DIR = resolve(ROOT, 'public/media/derivatives');
const MANIFEST_OUT = resolve(ROOT, 'src/data/generated/media-manifest.json');
const LEGACY_MANIFEST = resolve(DERIV_DIR, 'manifest.json');

const WIDTHS = [480, 768, 1280, 1920];
// 原图不在仓库时的构建期缓存：存放从 Studio 拉取的 jpg 母本（不进版本控制）
const MASTER_DIR = resolve(ROOT, '.media-cache');
const STUDIO_BASE = 'https://studio.salticidnotes.cn';
// 上传端只生成 ≤ 原图宽度的档位，取母本时从最大档逐档向下试探
const MASTER_WIDTHS = [1920, 1280, 768, 480];

/** 从 Studio 取该媒体最大的 jpg 母本（构建通道，凭 STUDIO_MEDIA_TOKEN），返回取到的宽度。 */
async function pullStudioMaster(publicId, out) {
  const token = process.env.STUDIO_MEDIA_TOKEN;
  if (!token) throw new Error('未配置构建环境变量 STUDIO_MEDIA_TOKEN');
  let lastError = new Error('Studio 里没有该媒体的任何派生图');
  for (const w of MASTER_WIDTHS) {
    const key = `${publicId}-${w}.jpg`;
    const url = `${STUDIO_BASE}/media/derivatives/${key}?token=${encodeURIComponent(token)}`;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
        // 404 = 该宽度档不存在（原图窄于此），直接试更小一档，不消耗重试
        if (res.status === 404) break;
        const buf = Buffer.from(await res.arrayBuffer());
        // 只认真 JPEG：被鉴权拦截时返回的是登录页/错误页，写盘即成伪图
        const isJpeg = res.ok && buf.length > 1024 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
        if (!isJpeg) throw new Error(`HTTP ${res.status}、${buf.length}B、响应不是 JPEG`);
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, buf);
        return w;
      } catch (e) {
        lastError = e;
        if (attempt < 3) console.warn(`[media] ${key} 第 ${attempt} 次拉取失败（${e.message}），重试…`);
      }
    }
  }
  throw lastError;
}

const FORMATS = [
  { ext: 'avif', fn: () => sharp().avif({ quality: 45 }) },
  { ext: 'webp', fn: () => sharp().webp({ quality: 72 }) },
  { ext: 'jpg', fn: () => sharp().jpeg({ quality: 82, mozjpeg: true }) },
];

async function main() {
  const media = JSON.parse(readFileSync(resolve(ROOT, 'src/data/media.json'), 'utf-8'));
  const observations = JSON.parse(readFileSync(resolve(ROOT, 'src/data/observations.json'), 'utf-8'));
  mkdirSync(DERIV_DIR, { recursive: true });

  // 只为「已发布且公开」观察的公开媒体生成派生图（prompt.md §42）
  const publishedObs = new Set(
    observations.filter((o) => o.status === 'published' && o.visibility === 'public').map((o) => o.id),
  );
  const publicMedia = media.filter((m) => m.visibility === 'public' && publishedObs.has(m.observation_id));

  // Studio 导出数据（存在时）合并进同一管线：source_original 已指向 media/originals/
  let studioMediaList = [];
  let studioObsList = [];
  try { studioMediaList = JSON.parse(readFileSync(resolve(ROOT, 'src/data/studio-media.json'), 'utf-8')); } catch {}
  try { studioObsList = JSON.parse(readFileSync(resolve(ROOT, 'src/data/studio-observations.json'), 'utf-8')); } catch {}
  const publishedStudioObs = new Set(
    studioObsList.filter((o) => o.status === 'published' && o.visibility === 'public').map((o) => o.id),
  );
  // observation_id 为 null 的 Studio 媒体是札记独立插图（导出端只收录已发布札记引用的图），
  // 与观察媒体走同一条派生管线，保证札记正文引用的编号都有产物。
  const allPublicMedia = [
    ...publicMedia,
    ...studioMediaList.filter(
      (m) => m.visibility === 'public' && (m.observation_id == null || publishedStudioObs.has(m.observation_id)),
    ),
  ];

  const manifest = {};
  let count = 0;
  mkdirSync(dirname(MANIFEST_OUT), { recursive: true });

  const fetchFailures = [];
  let pulledMasters = 0;
  for (const m of allPublicMedia) {
    // 仓库里有原图就用原图；缺失（新记录只永久存 R2）则改用上传时浏览器生成的 jpg 母本——
    // 公开站最大展示宽度就是 1920，母本一两百 KB，构建无需每次拖 20MB 级原图。
    let src = resolve(ROOT, m.source_original);
    if (!existsSync(src)) {
      const master = resolve(MASTER_DIR, `${m.id}-master.jpg`);
      try {
        if (!existsSync(master)) {
          await pullStudioMaster(m.id, master);
          pulledMasters += 1;
        }
        src = master;
      } catch (e) {
        fetchFailures.push(`${m.id} — ${e.message}`);
        continue;
      }
    }
    // rotate() 归一方向；重编码不保留任何元数据（EXIF/GPS 全部剥离）
    const pipeline = sharp(src).rotate();
    const rotated = await pipeline.metadata();
    const intrinsicW = rotated.width ?? 0;

    // 该图可用的宽度档位（不超过原始显示宽度；至少保留最小档）
    const widths = WIDTHS.filter((w) => w <= intrinsicW);
    if (widths.length === 0) widths.push(WIDTHS[0]);

    const variants = [];
    for (const w of widths) {
      for (const { ext, fn } of FORMATS) {
        const out = resolve(DERIV_DIR, `${m.id}-${w}.${ext}`);
        await pipeline.clone().resize({ width: w, withoutEnlargement: true }).toFormat(ext.split('.')[0], ext === 'avif' ? { quality: 45 } : ext === 'webp' ? { quality: 72 } : { quality: 82, mozjpeg: true }).toFile(out);
        count += 1;
      }
      variants.push(w);
    }

    // 兼容旧引用：thumb/medium/large JPG（灯箱大图、旧模板兜底）
    for (const [suffix, width] of [
      ['thumb', 400],
      ['medium', 1200],
      ['large', 2000],
    ]) {
      await pipeline
        .clone()
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality: suffix === 'thumb' ? 78 : 84, mozjpeg: true })
        .toFile(resolve(DERIV_DIR, `${m.id}_${suffix}.jpg`));
    }

    manifest[m.id] = {
      width: intrinsicW,
      height: rotated.height ?? 0,
      variants,
    };

    // 隐私断言：派生图不含 EXIF
    const check = await sharp(resolve(DERIV_DIR, `${m.id}_thumb.jpg`)).metadata();
    if (check.exif) throw new Error(`派生图 ${m.id} 仍含 EXIF——隐私检查失败`);
  }

  if (fetchFailures.length) {
    console.error(`\n[media] ${fetchFailures.length} 个公开媒体取不到图像源，构建中止（避免上线缺图产物）：`);
    for (const f of fetchFailures) console.error(`  · ${f}`);
    console.error(`排查顺序：
  1) Studio Worker 的 secret：cd studio-remote && npx wrangler secret put MEDIA_TOKEN
  2) 公开站构建环境变量 STUDIO_MEDIA_TOKEN 与之一致（Cloudflare → salticid-notes → Settings → Environment variables）
  3) 自检应返回 200 JPEG 而非 403/登录页：
     curl -sI "https://studio.salticidnotes.cn/media/derivatives/SN-2026-00001-1920.jpg?token=<MEDIA_TOKEN>"`);
    process.exit(1);
  }

  // v2 清单（构建期由 src/lib 静态导入；Worker 运行时零文件系统依赖）
  writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  // 旧清单（兼容 /media/derivatives/manifest.json 引用者）
  writeFileSync(LEGACY_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(
    `已生成 ${count} 张多格式派生图（自 Studio 取 jpg 母本 ${pulledMasters} 张）（${Object.keys(manifest).length}/${allPublicMedia.length} 个媒体，其余为非公开记录）。原图未做任何修改。`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
