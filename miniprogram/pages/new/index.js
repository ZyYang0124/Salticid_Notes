// 记录新观察：拍照/选图 → EXIF 建议落字段 → 逐张上传 → 学名 WSC 建档 → 字段落库 → 发布。
// 上传走手工 multipart（utils/multipart），与网页版 Studio 的 photos 端点同一契约。
const { BASE, api, request, parseBody, needLoginRedirect } = require('../../utils/api');
const { prepare } = require('../../utils/photo');
const { buildBody } = require('../../utils/multipart');

const PHOTO_MIME = 'image/jpeg';

Page({
  data: {
    photos: [], // {path, state: ready|uploading|done|error, error}
    observedAt: '',
    lat: '',
    lng: '',
    country: '',
    admin1: '',
    admin2: '',
    locality: '',
    siteName: '',
    habitat: '',
    note: '',
    species: '',
    speciesSlug: '',
    suggestions: [],
    exifHint: '',
    phase: 'editing', // editing → creating → ready → published
    publicId: '',
    busy: false,
    statusMsg: '',
    today: '',
  },

  onLoad() {
    this.setData({ today: new Date().toISOString().slice(0, 10) });
  },

  // —— 照片 ——

  choose() {
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['original'], // 保留 EXIF，供服务端读取拍摄时间与坐标
      success: (res) => {
        const add = res.tempFiles.map((f) => ({ path: f.tempFilePath, state: 'ready', error: '' }));
        const photos = this.data.photos.concat(add);
        this.setData({ photos });
        if (res.tempFiles.length) this.readExif(res.tempFiles[0].tempFilePath);
      },
    });
  },

  removePhoto(e) {
    const i = e.currentTarget.dataset.index;
    const photos = this.data.photos.slice();
    photos.splice(i, 1);
    this.setData({ photos });
  },

  // 第一张照片 → 服务端 EXIF 解析（复用 /studio/api/exif-preview）
  readExif(path) {
    wx.uploadFile({
      url: BASE + '/studio/api/exif-preview',
      filePath: path,
      name: 'photo',
      header: { Cookie: 'studio_session=' + wx.getStorageSync('studio_session') },
      success: (res) => {
        let d = null;
        try {
          d = JSON.parse(res.data);
        } catch (e) {
          return;
        }
        const s = d.results && d.results[0];
        if (!s) return;
        const patch = {};
        if (s.date && !this.data.observedAt) patch.observedAt = String(s.date).slice(0, 10);
        if (s.gps && !this.data.lat && !this.data.lng) {
          patch.lat = String(s.gps.lat);
          patch.lng = String(s.gps.lng);
        }
        if (patch.observedAt || patch.lat) {
          patch.exifHint = '检测到' + (patch.observedAt ? '拍摄时间' : '') + (patch.observedAt && patch.lat ? '与' : '') + (patch.lat ? '坐标' : '') + '，已填入下方字段，可修改。';
          this.setData(patch);
        }
      },
    });
  },

  // —— 表单 ——

  onField(e) {
    const patch = {};
    patch[e.currentTarget.dataset.k] = e.detail.value;
    this.setData(patch);
  },

  onDate(e) {
    this.setData({ observedAt: e.detail.value });
  },

  onSpecies(e) {
    const v = e.detail.value;
    // 输入变化即视为不再信任旧 slug，建档在提交时幂等完成
    this.setData({ species: v, speciesSlug: '', suggestions: [] });
    clearTimeout(this._suggestTimer);
    this._suggestTimer = setTimeout(() => this.suggest(v), 300);
  },

  // WSC 输入预测：无空格查属，属名+空格查该属 ACCEPTED 种
  async suggest(v) {
    const q = (v || '').trim();
    if (q.length < 2) {
      this.setData({ suggestions: [] });
      return;
    }
    const hasSpace = q.indexOf(' ') !== -1;
    const url = '/studio/api/wsc/complete?type=' + (hasSpace ? 'species' : 'genus') + '&q=' + encodeURIComponent(hasSpace ? q.replace(/\s+$/, '') : q);
    try {
      const { data } = await api(url);
      const items = (data.items || []).slice(0, 12).map((it) => ({ name: it.name || it.scientific_name || '', status: it.status || '' }));
      this.setData({ suggestions: items.filter((it) => it.name) });
    } catch (e) {
      if (e.needLogin) needLoginRedirect();
    }
  },

  pickSpecies(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({ species: name, suggestions: [] });
  },

  setPhoto(i, patch) {
    const photos = this.data.photos.slice();
    photos[i] = Object.assign({}, photos[i], patch);
    this.setData({ photos });
  },

  // —— 创建并上传 ——

  async createAndUpload() {
    if (this.data.busy || this.data.phase !== 'editing') return;
    if (!this.data.photos.length) {
      this.setData({ statusMsg: '请先添加至少一张照片' });
      return;
    }
    this.setData({ busy: true, phase: 'creating', statusMsg: '正在创建观察…' });
    try {
      const { data: created } = await api('/studio/api/observations', { method: 'POST', json: {} });
      const pid = created.public_id;
      this.setData({ publicId: pid, statusMsg: '已创建 ' + pid + '，正在上传照片…' });

      for (let i = 0; i < this.data.photos.length; i++) {
        await this.uploadPhoto(i, pid);
      }
      const failed = this.data.photos.filter((p) => p.state === 'error').length;
      if (failed === this.data.photos.length) throw new Error('所有照片上传失败，请检查网络后重试');

      const patch = this.fieldPatch();
      const sp = this.data.species.trim();
      if (sp) {
        const { data: t } = await api('/studio/api/taxa', { method: 'POST', json: { name: sp } });
        if (t && t.ok) patch.species_taxon_slug = t.taxon.slug;
      }
      await api('/studio/api/observations/' + pid, { method: 'PATCH', json: patch });

      this.setData({
        phase: 'ready',
        busy: false,
        statusMsg: failed
          ? failed + ' 张照片上传失败，其余已保存；可发布后到网页版补传'
          : '照片与信息已保存，可以发布了',
      });
    } catch (e) {
      this.setData({ busy: false, phase: 'editing', statusMsg: e.message });
      if (e.needLogin) needLoginRedirect();
    }
  },

  async uploadPhoto(i, pid) {
    const p = this.data.photos[i];
    this.setPhoto(i, { state: 'uploading', error: '' });
    try {
      const meta = await prepare(p.path);
      const boundary = 'sfn' + Date.now() + '_' + i;
      const files = [{ name: 'original', filename: 'photo.jpg', contentType: PHOTO_MIME, filePath: p.path }];
      meta.variants.forEach((v) => {
        files.push({ name: 'variant', filename: v.width + '.jpg', contentType: PHOTO_MIME, filePath: v.path });
      });
      const body = buildBody(boundary, { width: meta.width, height: meta.height }, files);
      const res = await request('/studio/observations/' + pid + '/photos', {
        method: 'POST',
        raw: body,
        timeout: 300000,
        header: { 'content-type': 'multipart/form-data; boundary=' + boundary },
      });
      const d = parseBody(res); // 会话过期被 302 到登录页时按 HTML 嗅探并抛 needLogin
      if (res.statusCode >= 200 && res.statusCode < 300 && d && d.ok) {
        this.setPhoto(i, { state: 'done' });
      } else {
        throw new Error((d && (d.error || d.message)) || '上传失败（' + res.statusCode + '）');
      }
    } catch (e) {
      if (e.needLogin) throw e;
      this.setPhoto(i, { state: 'error', error: e.message || '上传失败' });
    }
  },

  fieldPatch() {
    const d = this.data;
    return {
      observed_at: d.observedAt || d.today,
      latitude: d.lat,
      longitude: d.lng,
      country_name: d.country,
      admin1: d.admin1,
      admin2: d.admin2,
      locality: d.locality,
      site_name: d.siteName,
      habitat: d.habitat,
      field_note: d.note,
    };
  },

  // —— 发布 ——

  async publish() {
    if (this.data.busy || this.data.phase !== 'ready') return;
    this.setData({ busy: true, statusMsg: '正在发布…' });
    try {
      const { data } = await api('/studio/api/observations/' + this.data.publicId + '/publish', { method: 'POST', json: {} });
      if (data && data.ok) {
        this.setData({ busy: false, phase: 'published', statusMsg: '' });
        wx.showModal({
          title: '发布成功',
          content: this.data.publicId + ' 已公开，公开站将在几分钟内自动更新。',
          showCancel: false,
          success: () => wx.reLaunch({ url: '/pages/list/index' }),
        });
      } else {
        this.setData({ busy: false, statusMsg: (data && data.error) || '发布失败' });
      }
    } catch (e) {
      this.setData({ busy: false, statusMsg: e.message });
      if (e.needLogin) needLoginRedirect();
    }
  },
});
