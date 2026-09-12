// 客户端生成派生图（与网页版 Studio 相同档位约定）：480/768/1280/1920 中宽度 ≤ 原图宽的档。
// wx.compressImage 以 compressedWidth 等比压缩，输出 JPG 临时文件——正好满足服务端
// 变体命名 /^\d{3,4}\.(jpg|webp|avif)$/ 与「只生成 jpg 档」的线上约定。
// 公开站 <picture> 的 srcset 在仅有 jpg 档时自动降级，不产生兼容性问题。

const WIDTHS = [480, 768, 1280, 1920];

function info(path) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: path,
      success: resolve,
      fail: (e) => reject(new Error((e && e.errMsg) || '读取图片信息失败')),
    });
  });
}

function compressTo(path, width) {
  return new Promise((resolve) => {
    wx.compressImage({
      src: path,
      quality: 82,
      compressedWidth: width,
      success: (res) => resolve(res.tempFilePath),
      fail: () => resolve(''), // 单档失败不阻塞整张上传；原图仍在，公开端可用原图档
    });
  });
}

/** @returns {{width:number, height:number, variants:Array<{width:number, path:string}>}} */
async function prepare(path) {
  const meta = await info(path);
  const want = WIDTHS.filter((w) => w <= meta.width);
  const variants = [];
  for (const w of want) {
    const p = await compressTo(path, w);
    if (p) variants.push({ width: w, path: p });
  }
  return { width: meta.width, height: meta.height, variants };
}

module.exports = { prepare, WIDTHS };
