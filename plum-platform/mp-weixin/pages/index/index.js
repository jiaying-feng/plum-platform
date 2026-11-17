const api = require('../../services/api.js');
const cache = require('../../utils/cache.js');
const config = require('../../config/index.js');
const imgFallback = require('../../utils/imgFallback.js');

const HOME_KEY = 'home_v1';
const app = getApp();

// 与 tools/gen_map_base.py 的 PIN_ANCHORS 一一对应的底图标定锚点（left%, top%）。
// 按园区 id 匹配，mock 的 6 个点与 local/lan 的 5 个点都能落在各自的园区院落上；
// 未收录的点位回退到经纬度线性投影，避免数据增减时出现除零或越界。
const PIN_ANCHORS = [
  [15.5, 70.0], [31.0, 47.0], [44.5, 30.0],
  [55.0, 66.0], [73.0, 33.0], [86.5, 53.0],
];

Page({
  onImgError: imgFallback,

  data: {
    ready: false, loading: false, error: '', fromCache: false,
    banners: [], tip: {}, festivals: [], orchards: [], products: [], research: [], pins: [],
    question: '', answer: '', source: '', asking: false,
    envName: '',
    quick: [
      { type: 'orchard', label: '找园子' }, { type: 'product', label: '逛集市' },
      { type: 'research', label: '玩研学' }, { type: 'homestay', label: '住一晚' },
    ],
  },

  onLoad() {
    this.setData({ envName: config.getConfig().name });
    const cached = cache.get(HOME_KEY);
    if (cached) { this.apply(cached, true); }
    this.fetch(false);
  },

  onShow() {
    const name = config.getConfig().name;
    if (name !== this.data.envName) {
      this.setData({ envName: name });
      this.fetch(true);
    }
  },

  onPullDownRefresh() {
    this.fetch(true).then(() => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh());
  },

  apply(d, fromCache) {
    const list = d.orchards || [];
    const lngs = list.map((o) => Number(o.lng) || 0);
    const lats = list.map((o) => Number(o.lat) || 0);
    const minX = Math.min.apply(null, lngs.length ? lngs : [0]);
    const maxX = Math.max.apply(null, lngs.length ? lngs : [1]);
    const minY = Math.min.apply(null, lats.length ? lats : [0]);
    const maxY = Math.max.apply(null, lats.length ? lats : [1]);
    const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
    const pins = list.map((o, i) => {
      const anchor = PIN_ANCHORS[Number(o.id) - 1] || PIN_ANCHORS[i];
      return {
        id: o.id, name: o.name, index: i + 1,
        left: (anchor ? anchor[0] : 12 + ((Number(o.lng) - minX) / spanX) * 76).toFixed(1),
        top: (anchor ? anchor[1] : 84 - ((Number(o.lat) - minY) / spanY) * 68).toFixed(1),
      };
    });
    this.setData({
      banners: (d.banners || []).map((b, i) => Object.assign({}, b, { tone: (i % 4) + 1 })),
      tip: d.tip || {},
      festivals: (d.festivals || []).map((f, i) => Object.assign({}, f, { tone: (i % 4) + 1 })),
      orchards: list,
      products: (d.products || []).map((p, i) => Object.assign({}, p, { tone: (i % 4) + 1 })),
      research: (d.research || []).map((r, i) => Object.assign({}, r, { tone: (i % 4) + 1 })),
      pins, ready: true, error: '', fromCache: !!fromCache,
    });
  },

  fetch(force) {
    if (!force) {
      const cached = cache.get(HOME_KEY);
      if (cached && !this.data.ready) this.apply(cached, true);
    }
    this.setData({ loading: true, error: '' });
    return api.getHome().then((d) => {
      this.apply(d, false);
      cache.set(HOME_KEY, d, config.getConfig().cacheTTL);
      this.setData({ loading: false });
    }).catch((e) => {
      this.setData({ loading: false, ready: true, error: e.message || '首页没加载出来' });
      if (this.data.banners.length) {
        wx.showToast({ title: '暂时没刷新成，先看缓存内容', icon: 'none' });
        return;
      }
      // 真机上 local(127.0.0.1) 指向手机自身，lan 的 HTTP 会被合法域名/HTTPS 校验拦截。
      // 接口失败时回落到包内模拟数据，保证界面、点位地图与图片仍然完整可用。
      return api.getHomeOffline().then((d) => {
        this.apply(d, true);
        wx.showToast({ title: '连不上服务，已显示本地内容', icon: 'none' });
      }).catch(() => {
        wx.showToast({ title: '连不上服务，检查数据源设置', icon: 'none' });
      });
    });
  },

  retry() { this.fetch(true); },

  gotoList(e) {
    const type = e.currentTarget.dataset.type;
    app.setListType(type);
    wx.switchTab({ url: '/pages/list/list' });
  },

  gotoDetail(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/detail/detail?type=' + d.type + '&id=' + d.id });
  },

  onPin(e) {
    wx.navigateTo({ url: '/pages/detail/detail?type=orchard&id=' + e.currentTarget.dataset.id });
  },

  onQuestion(e) { this.setData({ question: e.detail.value }); },
  quickAsk(e) { this.setData({ question: e.currentTarget.dataset.q }); this.ask(); },
  ask() {
    const q = (this.data.question || '').trim();
    if (!q) { wx.showToast({ title: '先说一句想问的', icon: 'none' }); return; }
    this.setData({ asking: true, answer: '小梅翻翻账本…', source: '' });
    api.aiChat(q).then((d) => {
      this.setData({ answer: d.answer, source: d.source || '', asking: false });
    }).catch((e) => {
      this.setData({ answer: '这会儿没连上：' + e.message, asking: false });
    });
  },
});
