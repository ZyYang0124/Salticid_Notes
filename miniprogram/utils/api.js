// 请求封装：小程序原生请求无 Cookie 管理，手动接管 studio_session 会话。
// 服务端约定（studio-remote/src/auth.ts）：
//   - 未登录访问 /studio/api/* → 401 JSON；其余路径 → 302 登录页（表现为 200 HTML，需内容嗅探）
//   - 同源校验 sameOrigin 对无 Origin 头的请求放行 → 小程序无需伪造 Origin
const { BASE } = require('../config');

const COOKIE_KEY = 'studio_session';

function storedCookie() {
  return (wx.getStorageSync(COOKIE_KEY) || '') && COOKIE_KEY + '=' + wx.getStorageSync(COOKIE_KEY);
}

function pickSetCookie(header) {
  if (!header) return '';
  for (const k of Object.keys(header)) {
    if (k.toLowerCase() === 'set-cookie') return [].concat(header[k]).join('\n');
  }
  return '';
}

function request(path, { method = 'GET', form, json, raw, timeout, header = {} } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE + path,
      method,
      data: raw !== undefined ? raw : json !== undefined ? json : form,
      timeout: timeout || 60000,
      header: Object.assign(
        storedCookie() ? { Cookie: storedCookie() } : {},
        json !== undefined ? { 'content-type': 'application/json' } : {},
        form !== undefined ? { 'content-type': 'application/x-www-form-urlencoded' } : {},
        header,
      ),
      success: (res) => {
        const m = pickSetCookie(res.header).match(/studio_session=([^;\s]+)/);
        if (m) wx.setStorageSync(COOKIE_KEY, m[1]);
        resolve(res);
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '网络请求失败')),
    });
  });
}

/** 解析 JSON 响应体；会话丢失（被 302 到登录页 HTML）时按未登录处理 */
function parseBody(res) {
  if (typeof res.data === 'string') {
    if (res.data.indexOf('<') === 0 || res.data.indexOf('登录') !== -1) {
      const err = new Error('登录已过期，请重新登录');
      err.needLogin = true;
      throw err;
    }
    try {
      return JSON.parse(res.data);
    } catch (e) {
      const err = new Error('服务返回异常');
      err.raw = res.data;
      throw err;
    }
  }
  return res.data;
}

/** 访问受保护 API；401 → 清会话并标记 needLogin */
async function api(path, opts = {}) {
  const res = await request(path, opts);
  if (res.statusCode === 401) {
    wx.removeStorageSync(COOKIE_KEY);
    const err = new Error('未登录');
    err.needLogin = true;
    throw err;
  }
  return { res, data: parseBody(res) };
}

function needLoginRedirect() {
  wx.removeStorageSync(COOKIE_KEY);
  wx.reLaunch({ url: '/pages/login/index' });
}

module.exports = { BASE, request, api, parseBody, needLoginRedirect };
