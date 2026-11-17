const api = require('../../services/api.js');
const cache = require('../../utils/cache.js');
const config = require('../../config/index.js');
const auth = require('../../utils/auth.js');

const FAV_KEY = 'favorites';
const TYPE_NAME = { orchard: '青梅园', product: '好物', research: '研学', homestay: '民宿' };

function pad(n) { return n < 10 ? '0' + n : String(n); }
function dayAfter(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

Page({
  onImgError: require('../../utils/imgFallback.js'),

  data: {
    type: 'product', id: 0, typeName: '好物', ready: false, loading: false,
    error: '', fromCache: false, detail: {}, priceText: '', desc: '',
    sessionLabels: [], roomLabels: [], fav: false,
    sheet: false, submitting: false, result: null, talk: null,
    form: {
      quantity: 1, people: 2, guests: 2, sessionIndex: 0, roomIndex: 0,
      contact: '小梅', phone: '13700000001', receiver: '小梅',
      address: '大邑县䢺江镇游客中心', checkIn: dayAfter(1), checkOut: dayAfter(2),
    },
  },

  onLoad(options) {
    const type = options.type || 'product';
    const id = Number(options.id || 0);
    wx.setNavigationBarTitle({ title: TYPE_NAME[type] || '详情' });
    this.setData({ type, id, typeName: TYPE_NAME[type] || '详情' });
    const favs = (cache.get(FAV_KEY) || []).filter((x) => x && typeof x === 'object');
    this.setData({ fav: favs.some((x) => x.key === type + '_' + id) });
    this.load(false);
  },

  onPullDownRefresh() {
    this.load(true).then(
      () => wx.stopPullDownRefresh(), () => wx.stopPullDownRefresh()
    );
  },

  cacheKey() { return 'detail_' + this.data.type + '_' + this.data.id; },

  apply(d, fromCache) {
    let priceText = '', desc = '';
    if (this.data.type === 'product') {
      priceText = '¥' + d.price; desc = d.subtitle || '';
    } else if (this.data.type === 'orchard') {
      priceText = '大人 ¥' + d.adult_price + ' / 小孩 ¥' + d.child_price; desc = d.town + ' · ' + d.address;
    } else if (this.data.type === 'research') {
      priceText = '¥' + d.price + ' /人'; desc = (d.start_date || '') + ' 开课';
    } else {
      priceText = '可预订'; desc = d.town + ' · ' + d.address;
    }
    const patch = {
      detail: d, priceText, desc, ready: true, error: '', fromCache: !!fromCache,
      sessionLabels: (d.sessions || []).map((s) => s.date + ' ' + s.slot + ' · 余 ' + s.left + ' 位'),
      roomLabels: (d.rooms || []).map((r) => r.name + ' · ¥' + r.price + '/晚 · 余 ' + r.stock + ' 间'),
    };
    this.setData(patch);
  },

  load(force) {
    const cached = force ? null : cache.get(this.cacheKey());
    if (cached && !this.data.ready) this.apply(cached, true);
    this.setData({ loading: true, error: '' });
    return api.getDetail(this.data.type, this.data.id).then((d) => {
      this.apply(d, false);
      cache.set(this.cacheKey(), d, config.getConfig().cacheTTL);
      this.setData({ loading: false });
    }).catch((e) => {
      this.setData({ loading: false, ready: true, error: e.message || '详情没加载出来' });
    });
  },

  retry() { this.load(true); },

  toggleFav() {
    const key = this.data.type + '_' + this.data.id;
    // 收藏统一存对象；兼容早期可能残留的字符串格式
    const favs = (cache.get(FAV_KEY) || []).filter((x) => x && typeof x === 'object');
    const exists = favs.some((x) => x.key === key);
    const clean = exists ? favs.filter((x) => x.key !== key) : favs.concat([{
      key, type: this.data.type, id: this.data.id,
      title: this.data.detail.name || this.data.detail.title, typeName: this.data.typeName,
    }]);
    cache.set(FAV_KEY, clean, 0);
    this.setData({ fav: !exists });
    wx.showToast({ title: exists ? '已取消' : '收好了', icon: 'none' });
  },

  openSheet() {
    if (!auth.requireLogin()) return;
    this.setData({ sheet: true, result: null });
  },
  closeSheet() { this.setData({ sheet: false }); },
  stopBubble() {},
  onField(e) {
    const patch = {};
    patch['form.' + e.currentTarget.dataset.field] = e.detail.value;
    this.setData(patch);
  },
  onSession(e) { this.setData({ 'form.sessionIndex': Number(e.detail.value) }); },
  onRoom(e) { this.setData({ 'form.roomIndex': Number(e.detail.value) }); },
  onDate(e) {
    const patch = {};
    patch['form.' + e.currentTarget.dataset.field] = e.detail.value;
    this.setData(patch);
  },

  addCart() {
    if (!auth.requireLogin()) return;
    this.setData({ submitting: true });
    api.addToCart(this.data.id, Number(this.data.form.quantity)).then(() => {
      wx.showToast({ title: '放进篮子了', icon: 'success' });
      this.setData({ sheet: false, submitting: false });
    }).catch(() => this.setData({ submitting: false }));
  },

  submit() {
    if (!auth.requireLogin()) return;
    const t = this.data.type, f = this.data.form, d = this.data.detail;
    this.setData({ submitting: true });
    let task;
    if (t === 'product') {
      task = api.createOrder({
        receiver: f.receiver, phone: f.phone, address: f.address,
        items: [{ product_id: this.data.id, quantity: Number(f.quantity) }],
      }).then((order) => api.payOrder(order.id).then((pay) =>
        Object.assign({}, order, { status: pay.status, tip: pay.tip, checkin_code: '' })));
    } else if (t === 'orchard') {
      const s = (d.sessions || [])[Number(f.sessionIndex)];
      if (!s) { wx.showToast({ title: '这园子暂时没排场次', icon: 'none' });
        this.setData({ submitting: false }); return; }
      task = api.createReservation({
        session_id: s.id, people: Number(f.people), contact: f.contact, phone: f.phone,
      });
    } else if (t === 'research') {
      task = api.signupResearch({
        research_id: this.data.id, people: Number(f.people), contact: f.contact, phone: f.phone,
      });
    } else {
      const room = (d.rooms || [])[Number(f.roomIndex)];
      if (!room) { wx.showToast({ title: '这家暂时没有可订房型', icon: 'none' });
        this.setData({ submitting: false }); return; }
      task = api.bookHomestay({
        homestay_id: this.data.id, room_id: room.id, guests: Number(f.guests),
        check_in: f.checkIn, check_out: f.checkOut, contact: f.contact, phone: f.phone,
      });
    }
    task.then((r) => {
      getApp().bumpData();
      this.setData({ result: r, submitting: false });
      wx.showToast({ title: '办好了', icon: 'success' });
    }).catch(() => this.setData({ submitting: false }));
  },

  aiTalk() {
    api.aiTts(this.data.id, this.data.type === 'orchard' ? 'orchard' : 'spot').then((d) => {
      this.setData({ talk: d });
    }).catch(() => { /* 请求层已提示 */ });
  },

  gotoLogin() { wx.navigateTo({ url: '/pages/login/login' }); },
});
