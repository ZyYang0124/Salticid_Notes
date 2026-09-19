// EXIF 解析（Workers 版）：直接从 JPEG APP1 段提取 TIFF，交给 exif-reader。
// 只读拍摄日期与 GPS（Studio SOP §7：坐标全量精确公开，但仍须经贡献者确认）。
import exifReader from 'exif-reader';

export interface ExifSuggestion {
  date?: string;
  /** 完整拍摄时间（ISO），供批量分组按时间聚类 */
  datetime?: string;
  gps?: { lat: number; lng: number };
  /** 相机（Make + Model），仅用于编辑器展示 */
  camera?: string;
}

function dmsToDecimal(dms: unknown, ref: unknown): number | null {
  if (!Array.isArray(dms) || dms.length < 3) return null;
  const [d, m, s] = dms.map((x) => Number(x));
  if (![d, m, s].every((n) => Number.isFinite(n))) return null;
  let dec = d + m / 60 + s / 3600;
  const refStr = String(ref ?? '').toUpperCase();
  if (refStr === 'S' || refStr === 'W') dec = -dec;
  return Math.round(dec * 1e6) / 1e6;
}

export async function parseExif(buffer: ArrayBuffer): Promise<ExifSuggestion> {
  const out: ExifSuggestion = {};
  try {
    const b = new Uint8Array(buffer);
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return out; // 非 JPEG（PNG 无 EXIF GPS）
    let off = 2;
    while (off + 4 < b.length) {
      if (b[off] !== 0xff) {
        off += 1;
        continue;
      }
      const marker = b[off + 1];
      if (marker === 0xda) break; // SOS：扫到像素数据为止
      const len = (b[off + 2] << 8) | b[off + 3];
      if (len < 2) break;
      if (marker === 0xe1 && b[off + 4] === 0x45 && b[off + 5] === 0x78 && b[off + 6] === 0x69 && b[off + 7] === 0x66) {
        // APP1 "Exif\0\0" → TIFF 头
        const tiff = b.subarray(off + 10, off + 2 + len);
        // nodejs_compat 提供 Buffer 全局；TS 层经 globalThis 取用
        const parsed = exifReader((globalThis as any).Buffer.from(tiff)) as any;
        const dateVal = parsed?.Photo?.DateTimeOriginal ?? parsed?.Image?.DateTime;
        if (dateVal) {
          const d = new Date(dateVal);
          if (!Number.isNaN(d.getTime())) {
            out.date = d.toISOString().slice(0, 10);
            out.datetime = d.toISOString();
          }
        }
        const camera = [parsed?.Image?.Make, parsed?.Image?.Model].filter(Boolean).join(' ').trim();
        if (camera) out.camera = camera;
        const gps = parsed?.GPSInfo;
        if (gps) {
          const lat = dmsToDecimal(gps.GPSLatitude, gps.GPSLatitudeRef);
          const lng = dmsToDecimal(gps.GPSLongitude, gps.GPSLongitudeRef);
          if (lat != null && lng != null) out.gps = { lat, lng };
        }
        break;
      }
      off += 2 + len;
    }
  } catch {
    /* 损坏或缺失的 EXIF 一律按无建议处理 */
  }
  return out;
}
