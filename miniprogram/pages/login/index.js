// 邮箱 OTP 登录：与网页版 Studio 完全同一套受邀名单 + 验证码流程。
// 带 X-Studio-Api: 1 → 服务端返回 JSON（而非重定向）；会话经 Set-Cookie 下发，由 utils/api 统一接管。
const { request } = require('../../utils/api');

Page({
  data: {
    email: '',
    code: '',
    step: 1,
    sending: false,
    msg: '',
  },

  onEmail(e) {
    this.setData({ email: e.detail.value.trim(), msg: '' });
  },
  onCode(e) {
    this.setData({ code: e.detail.value.trim(), msg: '' });
  },

  async sendOtp() {
    if (!this.data.email) {
      this.setData({ msg: '请填写受邀邮箱' });
      return;
    }
    this.setData({ sending: true, msg: '正在发送验证码…' });
    try {
      const { data } = await this.call('/studio/login/otp', { email: this.data.email });
      if (data && data.ok) this.setData({ step: 2, msg: '验证码已发送至邮箱，十分钟内有效' });
      else this.setData({ msg: (data && data.message) || '发送失败' });
    } catch (e) {
      this.setData({ msg: e.message });
    }
    this.setData({ sending: false });
  },

  async verify() {
    if (!this.data.code) {
      this.setData({ msg: '请填写验证码' });
      return;
    }
    this.setData({ sending: true, msg: '正在验证…' });
    try {
      const { data } = await this.call('/studio/login/verify', {
        email: this.data.email,
        code: this.data.code,
      });
      if (data && data.ok) {
        wx.reLaunch({ url: '/pages/list/index' });
        return;
      }
      this.setData({ msg: (data && data.message) || '验证码无效或已过期' });
    } catch (e) {
      this.setData({ msg: e.message });
    }
    this.setData({ sending: false });
  },

  call(path, form) {
    return request(path, { method: 'POST', form, header: { 'X-Studio-Api': '1' } }).then((res) => {
      const data = typeof res.data === 'string' ? (() => { try { return JSON.parse(res.data); } catch (e) { return null; } })() : res.data;
      return { res, data };
    });
  },
});
