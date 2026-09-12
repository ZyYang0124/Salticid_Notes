// 手工拼 multipart/form-data。
// 原因：照片上传契约要求同一请求内包含 original + width/height + variant×N 多个文件，
// 而 wx.uploadFile 每次只能带一个文件；wx.request 的 data 传 ArrayBuffer 可原样发送，
// 故自行构造 multipart 报文（服务端 groupUploads 按字段出现顺序分组）。
// 环境差异：小程序无 Buffer / TextEncoder，UTF-8 编码需手写。

function utf8(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    const c = str.codePointAt(i);
    if (c > 0xffff) i += 1;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(out);
}

function concat(parts) {
  let total = 0;
  parts.forEach((p) => {
    total += p.byteLength;
  });
  const out = new Uint8Array(total);
  let offset = 0;
  parts.forEach((p) => {
    out.set(new Uint8Array(p), offset);
    offset += p.byteLength;
  });
  return out.buffer;
}

function fieldPart(boundary, name, value) {
  return utf8(
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="' + name + '"\r\n\r\n' +
    value + '\r\n',
  );
}

function filePart(boundary, name, filename, contentType, filePath) {
  const head =
    '--' + boundary + '\r\n' +
    'Content-Disposition: form-data; name="' + name + '"; filename="' + filename + '"\r\n' +
    'Content-Type: ' + contentType + '\r\n\r\n';
  const bin = wx.getFileSystemManager().readFileSync(filePath); // 无编码参数 → ArrayBuffer
  return concat([utf8(head), bin, utf8('\r\n')]);
}

/**
 * 构造完整 multipart 请求体。
 * @param {string} boundary
 * @param {Object} fields 普通字段 {name: value}
 * @param {Array}  files  文件序列 [{name, filename, contentType, filePath}]，顺序即服务端分组顺序
 * @returns {ArrayBuffer}
 */
function buildBody(boundary, fields, files) {
  const parts = [];
  Object.keys(fields || {}).forEach((k) => parts.push(fieldPart(boundary, k, String(fields[k]))));
  (files || []).forEach((f) => parts.push(filePart(boundary, f.name, f.filename, f.contentType, f.filePath)));
  parts.push(utf8('--' + boundary + '--\r\n'));
  return concat(parts);
}

module.exports = { buildBody, utf8, concat };
