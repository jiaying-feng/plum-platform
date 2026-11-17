/**
 * 个人中心：登录态校验、我的单据、集章、收藏、运行环境与缓存管理。
 *
 * - 所有数据都经 services/api.js，页面不感知 mock / 真实后端。
 * - 缓存按 userId 分 key，切换账号不会把上一个人的单据显示出来。
 * - 昵称取自本端会话 auth.getUser()，角色必须是「游客」，
 *   与 H5 / PC 后台共用的 localStorage 登录态彻底隔离。
 */
const api = require('../../services/api.js');
const auth = require('../../utils/auth.js');
const cache = require('../../utils/cache.js');
const config = require('../../config/index.js');

const SECTIONS = [
  { key: 'overview', name: '总览' },
  { key: 'bills', name: '单据' },
  { key: 'stamps', name: '集章' },
  { key: 'settings', name: '设置' },
];
const FAULTS = [
  { key: '', name: '正常（不注入故障）' },
  { key: '401', name: '模拟登录过期 401' },
  { key: '500', name: '模拟服务异常 500' },
  { key: 'network', name: '模拟网络断开' },
  { key: 'slow', name: '模拟慢网络 3 秒' },
];

function settle(p) {
  return p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e }));
}

Page({
  onImgError: require('../../utils/imgFallback.js'),

  data: {
    sections: SECTIONS, section: 'overview',
    logged: false, user: null, ready: false, loading: false,
    error: '', fromCache: false, busy: false,
    stats: [], overview: { counts: {}, bookings: [] },
    orders: [], reservations: [],
    spots: { spots: [], stamped: 0, total: 0 }, favorites: [],
    envKey: 'mock', envName: '', envList: [], envNames: [], envIndex: 0,
    baseUrl: '', useMock: true,
    faultIndex: 0, faultName: '', faultNames: FAULTS.map((f) => f.name),
    cacheInfo: { count: 0, sizeKB: 0, limitKB: 10240 },
  },

  onLoad() {
    this.lastStamp = '';
    this.loading = false;
    this.cacheKey = '';
    this.syncEnv();
    this.syncCacheInfo();
  },

  onShow() {
    const beforeKey = this.data.envKey;
    this.syncEnv();
    this.syncCacheInfo();
    const app = getApp();
    const user = auth.checkLogin() ? auth.getUser() : null;
    const identity = user ? String(user.userId) + '_' + user.nickname : '';
    const stamp = identity + '|' + (app.globalData.dataVersion || 0) + '|' +
      (app.globalData.justLoggedIn || 0);
    if (!this.data.ready || stamp !== this.lastStamp || beforeKey !== this.data.envKey) {
      this.lastStamp = stamp;
      this.refresh(false);
    }
  },

  onPullDownRefresh() {
    this.refresh(true).then(
      () => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh()
    );
  },

  // ---------- 环境 / 缓存信息 ----------
  syncEnv() {
    const cfg = config.getConfig();
    const list = config.getEnvList();
    let envIndex = 0;
    list.forEach((e, i) => { if (e.key === cfg.key) envIndex = i; });
    const fault = config.getFault();
    let faultIndex = 0;
    FAULTS.forEach((f, i) => { if (f.key === fault) faultIndex = i; });
    this.setData({
      envKey: cfg.key, envName: cfg.name, envList: list,
      envNames: list.map((e) => e.name), envIndex,
      baseUrl: cfg.baseUrl || '本地模拟数据，无请求地址',
      useMock: cfg.useMock, faultIndex, faultName: FAULTS[faultIndex].name,
    });
  },

  syncCacheInfo() { this.setData({ cacheInfo: cache.stats() }); },

  onEnvChange(e) {
    const i = Number(e.detail.value);
    const item = this.data.envList[i];
    if (!item) return;
    const before = config.getConfig();
    if (!config.setEnv(item.key)) return;
    const after = config.getConfig();
    // mock 会话在真实后端上无效，跨传输层切换时清掉登录态
    if (before.useMock !== after.useMock) auth.clear();
    cache.clearExcept(['favorites']);
    getApp().globalData.env = after.key;
    this.syncEnv();
    this.syncCacheInfo();
    wx.showToast({ title: '已切到' + after.name, icon: 'none' });
    this.refresh(true);
  },

  setLanBase() {
    wx.showModal({
      title: '局域网服务地址', editable: true,
      placeholderText: 'http://192.168.1.8:8080',
      content: config.getEnvList().filter((e) => e.key === 'lan')[0].baseUrl,
      success: (res) => {
        if (!res.confirm) return;
        if (!config.setLanBase(res.content)) {
          wx.showToast({ title: '要写完整的 http:// 或 https:// 地址', icon: 'none' });
          return;
        }
        cache.clearExcept(['favorites']);
        this.syncEnv();
        wx.showToast({ title: '地址记下了', icon: 'success' });
      },
    });
  },

  onFaultChange(e) {
    const i = Number(e.detail.value);
    const f = FAULTS[i];
    if (!f) return;
    config.setFault(f.key);
    this.syncEnv();
    wx.showToast({ title: f.key ? ('已注入：' + f.name) : '恢复正常', icon: 'none' });
  },

  clearCache() {
    wx.showModal({
      title: '清空本地缓存？', content: '首页、列表、详情和单据缓存会清掉，收藏保留。',
      success: (res) => {
        if (!res.confirm) return;
        cache.clearExcept(['favorites']);
        this.syncCacheInfo();
        wx.showToast({ title: '清好了', icon: 'success' });
        this.refresh(true);
      },
    });
  },

  // ---------- 数据 ----------
  readFavs() {
    return (cache.get('favorites') || []).filter((x) => x && typeof x === 'object' && x.key);
  },

  refresh(force) {
    if (this.loading) return Promise.resolve();
    const user = auth.getUser();
    if (!auth.checkLogin() || !user) {
      this.setData({
        logged: false, user: null, ready: true, loading: false, error: '',
        overview: { counts: {}, bookings: [] }, orders: [], reservations: [],
        stats: [], spots: { spots: [], stamped: 0, total: 0 }, favorites: this.readFavs(),
      });
      return Promise.resolve();
    }
    if (user.role !== '游客') {
      auth.clear();
      this.setData({ logged: false, user: null, ready: true, loading: false, error: '' });
      wx.showToast({ title: '这是游客端，请换游客账号', icon: 'none' });
      return Promise.resolve();
    }

    this.loading = true;
    this.cacheKey = 'mine_v1_' + user.userId;
    this.setData({ logged: true, user, loading: true, error: '' });
    if (!force) {
      const cached = cache.get(this.cacheKey);
      if (cached) this.apply(cached, true);
    }

    return Promise.all([
      settle(api.getMyOverview()),
      settle(api.getMyOrders()),
      settle(api.getMyReservations()),
      settle(api.getCheckinSpots()),
    ]).then((r) => {
      this.loading = false;
      const unauthorized = r.some((x) => !x.ok && x.e && x.e.code === 401);
      if (unauthorized) {
        this.setData({ logged: false, user: null, ready: true, loading: false, error: '' });
        return;
      }
      const okCount = r.filter((x) => x.ok).length;
      if (!okCount) {
        const e = r[0].e || {};
        this.setData({ ready: true, loading: false, error: e.message || '没加载出来，等下再试' });
        return;
      }
      const d = {
        overview: r[0].ok ? (r[0].v || {}) : {},
        orders: r[1].ok && Array.isArray(r[1].v) ? r[1].v : [],
        reservations: r[2].ok && Array.isArray(r[2].v) ? r[2].v : [],
        spots: r[3].ok ? (r[3].v || {}) : {},
      };
      this.apply(d, false);
      cache.set(this.cacheKey, d, config.getConfig().cacheTTL);
      this.setData({ loading: false, error: '' });
      this.syncCacheInfo();
      if (okCount < 4) {
        wx.showToast({ title: '有 ' + (4 - okCount) + ' 项没刷新成，先看已加载的', icon: 'none' });
      }
    }).catch((e) => {
      this.loading = false;
      this.setData({ ready: true, loading: false, error: (e && e.message) || '加载失败' });
    });
  },

  apply(d, fromCache) {
    const ov = d.overview || {};
    const counts = ov.counts || {};
    const sp = d.spots || {};
    this.setData({
      stats: [
        { label: '订单', value: counts.orders || 0 },
        { label: '预约', value: counts.reservations || 0 },
        { label: '盖章', value: counts.stamps || 0 },
        { label: '住店', value: counts.homestays || 0 },
      ],
      overview: {
        counts,
        bookings: (ov.bookings || []).map((b) => Object.assign({}, b, {
          typeName: b.type === 'reservation' ? '采摘' : (b.type === 'research' ? '研学' : '住店'),
        })),
      },
      orders: (d.orders || []).map((o) => Object.assign({}, o, {
        canEdit: o.status === '待支付',
      })),
      reservations: d.reservations || [],
      spots: {
        spots: (sp.spots || []).map((s, i) => Object.assign({}, s, {
          tone: (i % 4) + 1, imageText: String(s.name || '青梅').slice(0, 4),
        })),
        stamped: sp.stamped || 0, total: sp.total || 0,
      },
      favorites: this.readFavs(),
      ready: true, fromCache: !!fromCache, error: '',
    });
  },

  retry() { this.refresh(true); },

  // ---------- 交互 ----------
  switchSection(e) { this.setData({ section: e.currentTarget.dataset.section }); },
  gotoLogin() { wx.navigateTo({ url: '/pages/login/login' }); },

  logout() {
    wx.showModal({
      title: '退出登录？', content: '本端会话与单据缓存会清掉，收藏保留。',
      success: (res) => {
        if (!res.confirm) return;
        api.logout().catch(() => ({}));
        auth.clear();
        cache.clearExcept(['favorites']);
        this.syncCacheInfo();
        this.lastStamp = '';
        this.refresh(true);
        wx.showToast({ title: '已退出', icon: 'success' });
      },
    });
  },

  bump() {
    const app = getApp();
    app.globalData.dataVersion = (app.globalData.dataVersion || 0) + 1;
  },

  payOrder(e) {
    const id = Number(e.currentTarget.dataset.id);
    if (this.data.busy) return;
    this.setData({ busy: true });
    api.payOrder(id).then(() => {
      wx.showToast({ title: '付好啦', icon: 'success' });
      this.bump();
      return this.refresh(true);
    }).catch(() => { /* 请求层已提示 */ })
      .then(() => this.setData({ busy: false }));
  },

  cancelOrder(e) {
    const id = Number(e.currentTarget.dataset.id);
    wx.showModal({
      title: '取消这笔单？', content: '库存会退回去，钱也会原路退回。',
      success: (res) => {
        if (!res.confirm || this.data.busy) return;
        this.setData({ busy: true });
        api.cancelOrder(id).then(() => {
          wx.showToast({ title: '取消了', icon: 'success' });
          this.bump();
          return this.refresh(true);
        }).catch(() => { /* 请求层已提示 */ })
          .then(() => this.setData({ busy: false }));
      },
    });
  },

  stamp(e) {
    if (!auth.requireLogin()) return;
    const id = Number(e.currentTarget.dataset.id);
    if (this.data.busy) return;
    this.setData({ busy: true });
    api.checkin(id).then((r) => {
      wx.showToast({ title: (r && r.tip) || '盖好了', icon: 'none', duration: 2600 });
      this.bump();
      return this.refresh(true);
    }).catch(() => { /* 请求层已提示 */ })
      .then(() => this.setData({ busy: false }));
  },

  gotoDetail(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/detail/detail?type=' + d.type + '&id=' + d.id });
  },

  noop() {},
});
