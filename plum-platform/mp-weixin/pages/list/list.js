const api = require('../../services/api.js');
const cache = require('../../utils/cache.js');
const config = require('../../config/index.js');

const TYPES = [
  { key: 'orchard', name: '青梅园' }, { key: 'product', name: '好物' },
  { key: 'research', name: '研学' }, { key: 'homestay', name: '民宿' },
];
const app = getApp();

function normalize(row, type, index) {
  const out = {
    id: row.id, type, image: row.image || '', imageText: row.imageText || '青梅',
    tone: (index % 4) + 1, title: row.name || row.title || '未命名',
  };
  if (type === 'product') {
    out.desc = row.subtitle || '';
    out.priceText = '¥' + row.price;
    out.tag = '库 ' + row.stock;
  } else if (type === 'orchard') {
    out.desc = row.town + ' · ' + row.address;
    out.priceText = '大人 ¥' + row.adult_price;
    out.tag = row.open_time;
  } else if (type === 'research') {
    out.desc = row.start_date + ' 开课';
    out.priceText = '¥' + row.price + ' /人';
    out.tag = '余 ' + Math.max(0, row.capacity - row.signed) + ' 位';
  } else {
    out.desc = row.town + ' · ' + row.address;
    out.priceText = '可预订';
    out.tag = '住宿';
  }
  return out;
}

Page({
  onImgError: require('../../utils/imgFallback.js'),

  data: {
    types: TYPES, type: 'product', categories: [], categoryId: 0,
    keyword: '', inputValue: '', records: [], total: 0, pageNum: 1,
    loading: false, loadingMore: false, hasMore: true, noMore: false,
    error: '', fromCache: false, ready: false,
  },

  onLoad(options) {
    const type = options.type || app.globalData.listType || 'product';
    app.globalData.listType = type;
    this.setData({ type });
    this.token = 0;
    this.loadCategories();
    this.reload(false);
  },

  onShow() {
    const t = app.globalData.listType;
    if (t && t !== this.data.type) this.switchType(t);
  },

  onPullDownRefresh() {
    this.reload(true).then(
      () => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh()
    );
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading && !this.data.loadingMore && !this.data.error) {
      this.loadPage(this.data.pageNum + 1, false, this.token);
    }
  },

  loadCategories() {
    api.getCategories().then((list) => {
      this.setData({ categories: [{ id: 0, name: '全部' }].concat(list) });
    }).catch(() => { /* 门类加载失败不阻塞列表 */ });
  },

  cacheKey(page) {
    return 'list_' + this.data.type + '_' + this.data.categoryId + '_' +
      encodeURIComponent(this.data.keyword) + '_p' + page;
  },

  switchType(type) {
    if (!TYPES.some((t) => t.key === type)) return;
    app.globalData.listType = type;
    this.setData({ type, categoryId: 0, keyword: '', inputValue: '' });
    this.reload(false);
  },
  onType(e) { this.switchType(e.currentTarget.dataset.type); },

  onCategory(e) {
    this.setData({ categoryId: Number(e.currentTarget.dataset.id) });
    this.reload(true);
  },

  onInput(e) { this.setData({ inputValue: e.detail.value }); },
  onSearch(e) {
    this.setData({ keyword: (e.detail.value || '').trim(), inputValue: (e.detail.value || '').trim() });
    this.reload(true);
  },
  clearSearch() {
    this.setData({ keyword: '', inputValue: '' });
    this.reload(true);
  },

  reload(force) {
    this.token = (this.token || 0) + 1;
    const token = this.token;
    this.setData({
      pageNum: 1, records: [], total: 0, hasMore: true, noMore: false,
      loading: true, loadingMore: false, error: '', ready: true, fromCache: false,
    });
    if (!force) {
      const cached = cache.get(this.cacheKey(1));
      if (cached && cached.records) {
        const hasMore = cached.records.length < cached.total;
        this.setData({
          records: cached.records, total: cached.total, hasMore,
          noMore: !hasMore, loading: false, fromCache: true,
        });
      }
    }
    return this.loadPage(1, force, token);
  },

  loadPage(page, force, token) {
    const cfg = config.getConfig();
    const params = { pageNum: page, pageSize: cfg.pageSize, keyword: this.data.keyword };
    if (this.data.type === 'product' && this.data.categoryId) params.category_id = this.data.categoryId;
    if (page === 1) this.setData({ loading: true, error: '' });
    else this.setData({ loadingMore: true, error: '' });

    return api.getList(this.data.type, params).then((d) => {
      if (token !== this.token) return; // 丢弃切分类前的旧请求
      const fresh = (d.records || []).map((r, i) => normalize(r, this.data.type, i));
      const merged = page === 1 ? fresh : this.data.records.concat(fresh);
      const hasMore = merged.length < (d.total || 0);
      this.setData({
        records: merged, total: d.total || 0, pageNum: page,
        hasMore, noMore: !hasMore && merged.length > 0,
        loading: false, loadingMore: false, fromCache: false, error: '',
      });
      if (page === 1) {
        cache.set(this.cacheKey(1), { records: fresh, total: d.total || 0 }, cfg.cacheTTL);
      }
    }).catch((e) => {
      if (token !== this.token) return;
      this.setData({
        loading: false, loadingMore: false,
        error: e.message || '列表没加载出来',
        hasMore: false,
      });
    });
  },

  retry() { this.reload(true); },

  gotoDetail(e) {
    const d = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/detail/detail?type=' + d.type + '&id=' + d.id });
  },
});
