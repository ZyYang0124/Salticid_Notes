// 「我的观察」列表：GET /studio/api/observations（仅本人创建，草稿与已发布均含）。
const { api, needLoginRedirect } = require('../../utils/api');

Page({
  data: {
    loading: true,
    items: [],
    error: '',
  },

  onShow() {
    if (!wx.getStorageSync('studio_session')) {
      wx.reLaunch({ url: '/pages/login/index' });
      return;
    }
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    this.setData({ loading: true, error: '' });
    try {
      const { data } = await api('/studio/api/observations');
      const items = (data.observations || []).map((o) => ({
        id: o.public_id,
        date: (o.observed_at || '').slice(0, 10),
        status: o.status === 'published' ? '已发布' : '草稿',
        published: o.status === 'published',
        name: o.display_identification || 'Salticidae sp.',
        place: [o.admin1, o.admin2, o.locality].filter(Boolean).join(' · ') || '未填地点',
        photos: o.photo_count || 0,
      }));
      this.setData({ items, loading: false });
    } catch (e) {
      if (e.needLogin) {
        needLoginRedirect();
        return;
      }
      this.setData({ loading: false, error: e.message || '加载失败' });
    }
  },

  goNew() {
    wx.navigateTo({ url: '/pages/new/index' });
  },

  copyId(e) {
    wx.setClipboardData({ data: e.currentTarget.dataset.id });
  },
});
