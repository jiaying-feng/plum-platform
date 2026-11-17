/**
 * 业务接口集中定义：页面只依赖本文件，不直接拼 URL、不感知 mock / 真实环境。
 * 统一做三件事：图片地址补全、数组型接口分页对齐、写操作幂等号生成。
 *
 * 图片策略：真实后端可达时用后端图；mock 模式或后端不可达时用包内本地压缩图，
 * 因此手机端默认离线环境也能看到完整界面与真实图片，不依赖 127.0.0.1 / 局域网 / HTTPS。
 */
const request = require('../utils/request.js');
const config = require('../config/index.js');
const photos = require('../utils/photos.js');
const mockServer = require('../mock/server.js');

function newRequestId() {
  return 'mp-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
}

/** 后端返回 /assets/x.webp；mock 模式 config.asset() 为空，回落到包内同名/同类图。 */
function withPic(item, i) {
  return Object.assign({}, item, {
    image: config.asset(item.image) || photos.pick(item, i),
    imageText: String(item.name || item.title || '青梅').slice(0, 4),
  });
}
function withPics(list) { return (list || []).map((x, i) => withPic(x, i)); }

/** 首页数据整形：在线与离线两条链路共用，保证字段完全一致。 */
function shapeHome(d) {
  const src = d || {};
  return {
    banners: (src.banners || []).map((b, i) => {
      const p = typeof b === 'string' ? b : b.image;
      return {
        image: config.asset(p) || photos.pick({ image: p }, i),
        title: ['青梅熟了，上山走走', '亲手封一罐酒', '住一晚，推窗是梅园', '老街赶集，带点回去'][i % 4],
      };
    }),
    tip: src.season_tip || {},
    festivals: withPics(src.festivals),
    orchards: withPics(src.orchards),
    research: withPics(src.research),
    products: withPics(src.products),
  };
}

/** 后端 /api/research、/api/homestays 返回全量数组，这里统一包装成分页结构，页面逻辑一致。 */
function clientPage(list, params) {
  const q = params || {};
  let records = list.slice();
  const kw = String(q.keyword || '').trim();
  if (kw) {
    records = records.filter((x) => (String(x.name || '') + String(x.title || '') +
      String(x.address || '') + String(x.intro || '')).indexOf(kw) >= 0);
  }
  const pageNum = Math.max(1, parseInt(q.pageNum, 10) || 1);
  const pageSize = Math.max(1, parseInt(q.pageSize, 10) || 10);
  const start = (pageNum - 1) * pageSize;
  return {
    records: records.slice(start, start + pageSize),
    total: records.length, current: pageNum, size: pageSize,
  };
}

const LIST_PATH = {
  orchard: '/api/orchards', product: '/api/products',
  research: '/api/research', homestay: '/api/homestays',
};
const DETAIL_PATH = {
  orchard: '/api/orchards/', product: '/api/products/',
  research: '/api/research/', homestay: '/api/homestays/',
};

const api = {
  newRequestId,
  withPic,

  // ---------- 账号 ----------
  authLogin: (payload) => request.post('/api/auth/login', payload, { silent: true }),
  logout: () => request.post('/api/auth/logout', {}, { silent: true }),

  // ---------- 首页 / 内容 ----------
  getHome: () => request.get('/api/home').then(shapeHome),
  /** 只用于首页兜底：真机连不上后端时直接读包内模拟服务端，不发起任何网络请求。 */
  getHomeOffline: () => mockServer.handle({ path: '/api/home', method: 'GET', data: {}, header: {} })
    .then((body) => {
      if (!body || body.code !== 200) throw new Error('本地模拟数据不可用');
      return shapeHome(body.data || {});
    }),
  getCategories: () => request.get('/api/categories'),
  getFestivals: () => request.get('/api/festivals').then(withPics),
  getSeasonTips: () => request.get('/api/season-tips'),
  getCheckinSpots: () => request.get('/api/checkin-spots').then((d) =>
    Object.assign({}, d, { spots: withPics(d.spots) })),
  checkin: (spotId) => request.post('/api/checkin', { spot_id: spotId }, { needAuth: true }),

  // ---------- 列表 / 详情 ----------
  getList: (type, params) => {
    const path = LIST_PATH[type];
    if (!path) return Promise.reject(new Error('不支持的列表类型：' + type));
    return request.get(path, params || {}).then((d) => {
      const paged = Array.isArray(d) ? clientPage(d, params) : d;
      return Object.assign({}, paged, { records: withPics(paged.records) });
    });
  },
  getDetail: (type, id) => {
    const path = DETAIL_PATH[type];
    if (!path) return Promise.reject(new Error('不支持的详情类型：' + type));
    return request.get(path + id).then((d) => {
      const out = withPic(d, 0);
      if (d.sessions) out.sessions = d.sessions;
      if (d.rooms) out.rooms = withPics(d.rooms);
      return out;
    });
  },

  // ---------- 购物车 / 订单 ----------
  getCart: () => request.get('/api/cart', {}, { needAuth: true }),
  addToCart: (productId, quantity) => request.post('/api/cart',
    { product_id: productId, quantity: quantity || 1 }, { needAuth: true }),
  createOrder: (payload) => request.post('/api/orders',
    Object.assign({ requestId: newRequestId() }, payload), { needAuth: true }),
  payOrder: (id) => request.post('/api/orders/' + id + '/pay', {}, { needAuth: true }),
  cancelOrder: (id) => request.post('/api/orders/' + id + '/cancel', {}, { needAuth: true }),

  // ---------- 预约 / 报名 / 预订 ----------
  createReservation: (payload) => request.post('/api/reservations',
    Object.assign({ requestId: newRequestId() }, payload), { needAuth: true }),
  signupResearch: (payload) => request.post('/api/research/signup',
    Object.assign({ requestId: newRequestId() }, payload), { needAuth: true }),
  bookHomestay: (payload) => request.post('/api/homestay-bookings',
    Object.assign({ requestId: newRequestId() }, payload), { needAuth: true }),

  // ---------- 我的 ----------
  getMyOverview: () => request.get('/api/my/overview', {}, { needAuth: true }),
  getMyOrders: () => request.get('/api/my/orders', {}, { needAuth: true }),
  getMyReservations: () => request.get('/api/my/reservations', {}, { needAuth: true }).then(withPics),

  // ---------- 本地 AI ----------
  aiChat: (question) => request.post('/api/ai/chat', { question }),
  aiItinerary: (days) => request.post('/api/ai/itinerary', { days }),
  aiTts: (targetId, targetType) => request.post('/api/ai/tts',
    { target_id: targetId, target_type: targetType || 'orchard' }),
};

module.exports = api;
