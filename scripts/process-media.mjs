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

  let skippedMissing = 0;
  let fetchedMissing = 0;
  for (const m of allPublicMedia) {
    const src = resolve(ROOT, m.source_original);
    if (!existsSync(src)) {
      // 原图不在仓库：从 Studio 的 R2 流端点拉取（原图永久存 R2，仓库不再承担新原图）。
      // 需要 Pages 构建环境变量 STUDIO_MEDIA_TOKEN（与 Worker 的 MEDIA_TOKEN 一致）。
      const token = process.env.STUDIO_MEDIA_TOKEN;
      if (!token) {
        console.warn(`[media] 原图缺失且未配置 STUDIO_MEDIA_TOKEN，跳过：${m.source_original}`);
        skippedMissing += 1;
        continue;
      }
      const url = `https://studio.salticidnotes.cn/studio/media-original/${m.id}?token=${encodeURIComponent(token)}`;
      try {
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        mkdirSync(dirname(src), { recursive: true });
        writeFileSync(src, buf);
        fetchedMissing += 1;
      } catch (e) {
        console.warn(`[media] 原图拉取失败，跳过：${m.source_original}（${e.message}）`);
        skippedMissing += 1;
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

  // v2 清单（构建期由 src/lib 静态导入；Worker 运行时零文件系统依赖）
  writeFileSync(MANIFEST_OUT, JSON.stringify(manifest, null, 2));
  // 旧清单（兼容 /media/derivatives/manifest.json 引用者）
  writeFileSync(LEGACY_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(
    `已生成 ${count} 张多格式派生图（缺失原图跳过 ${skippedMissing}，自 R2 补拉 ${fetchedMissing}）（${Object.keys(manifest).length}/${allPublicMedia.length} 个媒体，其余为非公开记录）。原图未做任何修改。`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
