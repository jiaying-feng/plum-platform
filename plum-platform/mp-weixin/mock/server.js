/**
 * 本地模拟服务端：按与 Flask 后端完全一致的 {code,msg,data} 契约返回。
 * 支持分页、关键词过滤、幂等 requestId、登录态校验、故障注入，
 * 因此页面里的分页 / 下拉刷新 / 鉴权 / 错误处理在 mock 模式下都是真实生效的。
 *
 * 想接真实后端：config.setEnv('local')，本文件不再被调用，业务代码零改动。
 */
const config = require('../config/index.js');
const D = require('./data.js');

const ok = (data) => ({ code: 200, msg: 'success', data: data === undefined ? {} : data });
const fail = (code, msg) => ({ code, msg, data: null });

const idemStore = {};
const sessions = {};
const cart = [];
const myOrders = D.orders.slice();
const myReservations = D.reservations.slice();
const signups = [];
const bookings = [];
const stamped = [1, 2];

function pad(n) { return n < 10 ? '0' + n : String(n); }
function dateAfter(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function nowText() {
  const d = new Date();
  return dateAfter(0) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function rid(prefix) { return prefix + Date.now() + Math.floor(Math.random() * 1000); }

// 每个园区固定 3 天 × 2 个时段，余位确定性生成，便于分页与预约验收
const SESSIONS = [];
D.orchards.forEach((o) => {
  [1, 3, 6].forEach((delta, di) => {
    ['上午 09:00-11:30', '下午 14:00-16:30'].forEach((slot, si) => {
      const cap = 40;
      const booked = (o.id * 3 + di * 2 + si) % 12;
      SESSIONS.push({
        id: SESSIONS.length + 1, orchard_id: o.id, session_date: dateAfter(delta),
        slot, capacity: cap, booked, left: cap - booked,
        audit_status: '已通过', status: '可预约',
      });
    });
  });
});

function paginate(list, q) {
  const pageNum = Math.max(1, parseInt(q.pageNum, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(q.pageSize, 10) || 10));
  const start = (pageNum - 1) * pageSize;
  return { records: list.slice(start, start + pageSize), total: list.length, current: pageNum, size: pageSize };
}
/** 按 X-Session-Id 反查登录账号。冷启动后本地 token 仍在，惰性恢复到会话表。 */
function accountOf(header) {
  const sid = String((header && header['X-Session-Id']) || '');
  if (!sid) return null;
  // 显式置空表示已登出，此时不再惰性恢复
  if (Object.prototype.hasOwnProperty.call(sessions, sid)) return sessions[sid] || null;
  const m = sid.match(/^mock-session-(\d+)$/);
  if (m) {
    const acc = D.accounts.filter((a) => a.userId === Number(m[1]))[0];
    if (acc) { sessions[sid] = acc; return acc; }
  }
  return null;
}
function authGuard(header) {
  return accountOf(header) ? null : fail(401, '请先登录，再接着办');
}
function text(v) { return v === undefined || v === null ? '' : String(v).trim(); }
function validPhone(v) { return /^\d{11}$/.test(text(v)); }
function intVal(v, def) { const n = parseInt(v, 10); return isNaN(n) ? def : n; }

function route(path, method, q, header) {
  const p = String(path || '').split('?')[0];
  const M = method.toUpperCase();

  // ---------- 账号 ----------
  if (M === 'POST' && p === '/api/auth/login') {
    const acc = D.accounts.filter((a) => a.username === text(q.username) && a.password === text(q.password))[0];
    if (!acc) return fail(401, '账号或口令不对，再看看');
    if (q.role && q.role !== acc.role) return fail(403, '这个账号是「' + acc.role + '」，请从对应入口进');
    const sessionId = 'mock-session-' + acc.userId;
    sessions[sessionId] = acc;
    return ok({ sessionId, userId: acc.userId, nickname: acc.nickname, role: acc.role });
  }
  if (M === 'POST' && p === '/api/auth/logout') {
    const sid = String((header && header['X-Session-Id']) || '');
    sessions[sid] = null;
    return ok({ bye: true });
  }

  // ---------- 首页 / 内容 ----------
  if (M === 'GET' && p === '/api/home') {
    const month = new Date().getMonth() + 1;
    const tip = D.seasonTips.filter((t) => {
      const m = t.month_range.match(/(\d+)月—(\d+)月/);
      return m && month >= +m[1] && month <= +m[2];
    })[0] || D.seasonTips[0];
    return ok({
      banners: D.banners, season_tip: tip,
      festivals: D.festivals.filter((f) => f.status === '展示中'),
      orchards: D.orchards.slice(0, 6).map((o) => ({
        id: o.id, name: o.name, town: o.town, address: o.address, lng: o.lng, lat: o.lat,
        image: o.image, adult_price: o.adult_price, child_price: o.child_price,
      })),
      research: D.research.slice(0, 3), products: D.products.slice(0, 4),
    });
  }
  if (M === 'GET' && p === '/api/categories') return ok(D.categories);
  if (M === 'GET' && p === '/api/festivals') return ok(D.festivals.filter((f) => f.status === '展示中'));
  if (M === 'GET' && p === '/api/season-tips') return ok(D.seasonTips);

  // ---------- 列表 / 详情 ----------
  if (M === 'GET' && p === '/api/orchards') {
    let list = D.orchards.slice();
    const kw = text(q.keyword), town = text(q.town);
    if (kw) list = list.filter((o) => (o.name + o.address + o.intro).indexOf(kw) >= 0);
    if (town && town !== '全部') list = list.filter((o) => o.town === town);
    return ok(paginate(list, q));
  }
  let m = p.match(/^\/api\/orchards\/(\d+)$/);
  if (M === 'GET' && m) {
    const o = D.orchards.filter((x) => x.id === +m[1])[0];
    if (!o) return fail(404, '没找到这个园子');
    const sessions = SESSIONS.filter((s) => s.orchard_id === o.id).map((s) => ({
      id: s.id, date: s.session_date, slot: s.slot, left: s.left,
    }));
    return ok(Object.assign({}, o, { sessions }));
  }

  if (M === 'GET' && p === '/api/products') {
    let list = D.products.slice();
    const kw = text(q.keyword), cat = text(q.category_id);
    if (kw) list = list.filter((x) => (x.name + x.subtitle).indexOf(kw) >= 0);
    if (cat && /^\d+$/.test(cat)) list = list.filter((x) => x.category_id === +cat);
    return ok(paginate(list, q));
  }
  m = p.match(/^\/api\/products\/(\d+)$/);
  if (M === 'GET' && m) {
    const item = D.products.filter((x) => x.id === +m[1])[0];
    return item ? ok(Object.assign({}, item, { category_name: D.categories[(item.category_id - 1) % 4].name }))
      : fail(404, '没找到这件商品');
  }

  if (M === 'GET' && p === '/api/research') return ok(D.research);
  m = p.match(/^\/api\/research\/(\d+)$/);
  if (M === 'GET' && m) {
    const item = D.research.filter((x) => x.id === +m[1])[0];
    return item ? ok(item) : fail(404, '没找到这门课');
  }

  if (M === 'GET' && p === '/api/homestays') {
    return ok(D.homestays.map((h) => {
      const copy = Object.assign({}, h);
      delete copy.rooms;
      return copy;
    }));
  }
  m = p.match(/^\/api\/homestays\/(\d+)$/);
  if (M === 'GET' && m) {
    const item = D.homestays.filter((x) => x.id === +m[1])[0];
    return item ? ok(item) : fail(404, '没找到这家民宿');
  }

  // ---------- 打卡集章 ----------
  if (M === 'GET' && p === '/api/checkin-spots') {
    return ok({
      spots: D.checkinSpots.map((s) => Object.assign({}, s, { stamped: stamped.indexOf(s.id) >= 0 })),
      stamped: stamped.length, total: D.checkinSpots.length,
    });
  }
  if (M === 'POST' && p === '/api/checkin') {
    const g = authGuard(header); if (g) return g;
    const id = intVal(q.spot_id, 0);
    if (!D.checkinSpots.some((s) => s.id === id)) return fail(404, '没找到这个打卡点');
    if (stamped.indexOf(id) >= 0) return fail(409, '今天这枚章已经盖过啦');
    stamped.push(id);
    return ok({ stamped: stamped.length, total: D.checkinSpots.length,
      tip: stamped.length >= D.checkinSpots.length ? '六枚章集齐啦，到游客中心换一份青梅伴手礼！'
        : '又盖上一枚，已经集了 ' + stamped.length + '/' + D.checkinSpots.length + ' 枚，接着逛～' });
  }

  // ---------- 购物车 / 订单 ----------
  if (M === 'GET' && p === '/api/cart') {
    const g = authGuard(header); if (g) return g;
    return ok({ items: cart.slice(), total: cart.reduce((s, x) => s + (+x.price) * x.quantity, 0).toFixed(2) });
  }
  if (M === 'POST' && p === '/api/cart') {
    const g = authGuard(header); if (g) return g;
    const prod = D.products.filter((x) => x.id === intVal(q.product_id, 0))[0];
    if (!prod) return fail(404, '这件商品暂时买不了');
    const num = Math.max(1, Math.min(99, intVal(q.quantity, 1)));
    const hit = cart.filter((x) => x.product_id === prod.id)[0];
    if (hit) hit.quantity = Math.min(99, hit.quantity + num);
    else cart.push({ id: cart.length + 1, product_id: prod.id, name: prod.name,
      subtitle: prod.subtitle, price: prod.price, image: prod.image, stock: prod.stock, quantity: num });
    return ok({ product_id: prod.id, quantity: num });
  }
  if (M === 'POST' && p === '/api/orders') {
    const g = authGuard(header); if (g) return g;
    if (!text(q.receiver) || !text(q.address) || !validPhone(q.phone)) return fail(422, '收货人、地址和 11 位手机号都要填');
    const key = text(q.requestId);
    if (!key) return fail(400, '缺少 requestId');
    if (idemStore[key]) return ok(idemStore[key]);
    let chosen = [];
    if (q.items && q.items.length) {
      q.items.forEach((it) => {
        const prod = D.products.filter((x) => x.id === intVal(it.product_id, 0))[0];
        if (prod) chosen.push({ name: prod.name, price: prod.price, quantity: Math.max(1, intVal(it.quantity, 1)) });
      });
    } else {
      chosen = cart.map((x) => ({ name: x.name, price: x.price, quantity: x.quantity }));
    }
    if (!chosen.length) return fail(422, '购物车还是空的，先挑点东西吧');
    const amount = chosen.reduce((s, x) => s + (+x.price) * x.quantity, 0).toFixed(2);
    const result = { id: myOrders.length + 1, order_no: rid('PM'), status: '待支付', amount, items: chosen };
    myOrders.unshift(Object.assign({}, result, {
      created_at: nowText(), receiver: text(q.receiver), phone: text(q.phone), address: text(q.address),
    }));
    cart.length = 0;
    idemStore[key] = result;
    return ok(result);
  }
  m = p.match(/^\/api\/orders\/(\d+)\/(pay|cancel)$/);
  if (M === 'POST' && m) {
    const g = authGuard(header); if (g) return g;
    const order = myOrders.filter((x) => x.id === +m[1])[0];
    if (!order) return fail(404, '没找到这笔订单');
    const target = m[2] === 'pay' ? '已支付' : '已取消';
    if (order.status !== '待支付') return fail(409, '「' + order.status + '」不能直接变成「' + target + '」');
    order.status = target;
    return ok({ id: order.id, status: target, tip: target === '已支付' ? '付好啦，农户这就给您备货' : '取消了，库存已退回' });
  }

  // ---------- 预约 / 报名 / 预订 ----------
  if (M === 'POST' && p === '/api/reservations') {
    const g = authGuard(header); if (g) return g;
    if (!text(q.contact) || !validPhone(q.phone)) return fail(422, '联系人和 11 位手机号都要填');
    const s = SESSIONS.filter((x) => x.id === intVal(q.session_id, 0))[0];
    if (!s) return fail(404, '没找到这场采摘');
    const people = Math.max(1, Math.min(20, intVal(q.people, 1)));
    if (s.left < people) return fail(422, '只剩 ' + s.left + ' 个位置了，换个日子看看');
    const key = text(q.requestId);
    if (key && idemStore[key]) return ok(idemStore[key]);
    const o = D.orchards.filter((x) => x.id === s.orchard_id)[0];
    const result = {
      id: myReservations.length + 1, code: rid('YY'), checkin_code: rid('CK'),
      status: '待核销', amount: (people * (+o.adult_price)).toFixed(2), orchard: o.name,
      date: s.session_date, slot: s.slot, people, tip: '到场把核销码给园主看一下就能进园啦',
    };
    s.booked += people; s.left -= people;
    myReservations.unshift(Object.assign({}, result, { orchard_name: o.name,
      visit_date: s.session_date, created_at: nowText() }));
    if (key) idemStore[key] = result;
    return ok(result);
  }
  if (M === 'POST' && p === '/api/research/signup') {
    const g = authGuard(header); if (g) return g;
    const r = D.research.filter((x) => x.id === intVal(q.research_id, 0))[0];
    if (!r) return fail(404, '没找到这门课');
    const people = Math.max(1, Math.min(10, intVal(q.people, 1)));
    if (r.capacity - r.signed < people) return fail(422, '只剩 ' + (r.capacity - r.signed) + ' 个位置了，换个日子看看');
    if (!text(q.contact) || !validPhone(q.phone)) return fail(422, '联系人和 11 位手机号都要填');
    if (signups.some((x) => x.research_id === r.id)) return fail(422, '这门课你已经报过名啦');
    const key = text(q.requestId);
    if (key && idemStore[key]) return ok(idemStore[key]);
    const result = { id: signups.length + 1, code: rid('YJ'), checkin_code: rid('CK'),
      status: '待核销', amount: (people * (+r.price)).toFixed(2), title: r.title, people };
    r.signed += people; signups.push(result);
    if (key) idemStore[key] = result;
    return ok(result);
  }
  if (M === 'POST' && p === '/api/homestay-bookings') {
    const g = authGuard(header); if (g) return g;
    const h = D.homestays.filter((x) => x.id === intVal(q.homestay_id, 0))[0];
    const room = h && h.rooms.filter((x) => x.id === intVal(q.room_id, 0))[0];
    if (!room) return fail(404, '没找到这个房型');
    const ci = text(q.check_in), co = text(q.check_out);
    const nights = Math.round((new Date(co) - new Date(ci)) / 86400000);
    if (!ci || !co || nights < 1 || nights > 30) return fail(422, '入住日期得从今天起，退房要晚于入住，一次最多订 30 天');
    const guests = Math.max(1, Math.min(10, intVal(q.guests, 1)));
    if (guests > room.capacity) return fail(422, '这间房最多住 ' + room.capacity + ' 人');
    if (room.stock < 1) return fail(422, '这几晚房间订满啦，换个日子看看');
    if (!text(q.contact) || !validPhone(q.phone)) return fail(422, '联系人和 11 位手机号都要填');
    const key = text(q.requestId);
    if (key && idemStore[key]) return ok(idemStore[key]);
    const result = { id: bookings.length + 1, code: rid('MS'), checkin_code: rid('CK'),
      status: '待核销', amount: (nights * (+room.price)).toFixed(2), nights };
    room.stock -= 1; bookings.push(result);
    if (key) idemStore[key] = result;
    return ok(result);
  }

  // ---------- 我的 ----------
  if (M === 'GET' && p === '/api/my/overview') {
    const g = authGuard(header); if (g) return g;
    const acc = accountOf(header);
    return ok({
      nickname: acc.nickname, role: acc.role,
      counts: { orders: myOrders.length, reservations: myReservations.length,
        research: signups.length, homestays: bookings.length, stamps: stamped.length },
      bookings: myReservations.slice(0, 5).map((r) => ({
        type: 'reservation', code: r.code, status: r.status,
        checkin_code: r.checkin_code, date: r.visit_date || r.date,
      })),
    });
  }
  if (M === 'GET' && p === '/api/my/orders') {
    const g = authGuard(header); if (g) return g;
    return ok(myOrders);
  }
  if (M === 'GET' && p === '/api/my/reservations') {
    const g = authGuard(header); if (g) return g;
    return ok(myReservations);
  }

  // ---------- 本地 AI：答案全部取自上面的真实模拟业务数据 ----------
  if (M === 'POST' && p === '/api/ai/chat') {
    const question = text(q.question);
    if (!question) return fail(400, '想问什么，直接说就行');
    const wine = D.products.filter((x) => x.name.indexOf('青梅酒') >= 0)[0];
    if (question.indexOf('酒') >= 0 && question.indexOf('钱') >= 0 || question.indexOf('多少钱') >= 0) {
      return ok({ answer: '「' + wine.name + '」' + wine.price + ' 元一瓶，五年陈酿礼盒也有，镇上老街酒坊能先试再买。',
        source: '平台实时数据', degraded: false, topic: '业务' });
    }
    if (question.indexOf('位置') >= 0 || question.indexOf('还有') >= 0) {
      const s = SESSIONS[0];
      return ok({ answer: '最近的 ' + s.session_date + ' 在' + D.orchards[0].name + '，' + s.slot + '，还剩 ' + s.left + ' 个位置。',
        source: '平台实时数据', degraded: false, topic: '业务' });
    }
    if (question.indexOf('住') >= 0) {
      const h = D.homestays[0];
      return ok({ answer: h.name + '的' + h.rooms[0].name + '一晚 ' + h.rooms[0].price + ' 元，推窗就是梅园。',
        source: '平台实时数据', degraded: false, topic: '业务' });
    }
    return ok({ answer: '这个我还真说不准，怕给你说错了。要不问问「采摘怎么收费」「这周还有位置吗」，我手里的园子、房价、场次都是实时的。',
      source: '兜底', degraded: false, topic: '其它',
      suggestions: ['青梅酒多少钱？', '周末还有位置吗？', '住一晚多少钱？'] });
  }
  if (M === 'POST' && p === '/api/ai/itinerary') {
    const days = String(q.days) === '2' ? 2 : 1;
    let textOut = '【第一天 · 慢慢逛】\n09:00 游客中心领一张手绘地图，先盖第一枚章。\n'
      + '09:30 ' + D.orchards[0].name + '摘梅子，大人 ' + D.orchards[0].adult_price + ' 元。\n'
      + '13:30 研学基地上「' + D.research[0].title + '」，亲手封一罐酒。\n'
      + '16:00 特产铺子挑点青梅酒和蜜饯。';
    if (days === 2) textOut += '\n\n【第二天 · 住一晚】\n住' + D.homestays[0].name + '，早上老街散步，酒坊看老师傅开坛。';
    return ok({ itinerary: textOut, days, source: '平台实时数据', degraded: false });
  }
  if (M === 'POST' && p === '/api/ai/tts') {
    const isOrchard = q.target_type === 'orchard';
    const o = D.orchards.filter((x) => x.id === intVal(q.target_id, 1))[0] || D.orchards[0];
    const s = D.checkinSpots.filter((x) => x.id === intVal(q.target_id, 1))[0] || D.checkinSpots[0];
    const name = isOrchard ? o.name : s.name;
    const segments = isOrchard ? [
      '你现在站的这儿，是' + o.name + '。' + o.intro,
      '园子' + o.open_time + '开门，大人 ' + o.adult_price + ' 元，小朋友 ' + o.child_price + ' 元，门票里含两斤梅子。',
      '这一片是' + o.town + '的老梅林，地势平缓，小孩子也走得动。梅子熟的时候，坐下来喝杯青梅茶再走。',
    ] : [
      '你现在站的这儿，是' + s.name + '。' + s.intro,
      '顺着老街往前走，就是梅园和酒坊，一路都能盖章。',
      '别赶时间。梅子熟的时候，风里都是酸甜味。',
    ];
    return ok({ title: name + ' · 语音讲解', text: segments.join(' '), segments,
      mode: 'browser-speech', source: '平台实时数据', degraded: false });
  }

  return fail(404, '接口不存在，检查一下地址');
}

function handle(ctx) {
  const p = String(ctx.path || '').split('?')[0];
  // 故障注入只作用于业务接口；登录/登出始终可用，方便在设置页把故障关掉
  const bypass = p === '/api/auth/login' || p === '/api/auth/logout';
  const fault = bypass ? '' : config.getFault();
  if (fault === 'network') return Promise.reject(new Error('MOCK_NETWORK_DOWN'));
  const delay = fault === 'slow' ? 3000 : 160 + Math.random() * 180;
  return new Promise((resolve) => {
    setTimeout(() => {
      if (fault === '401') return resolve(fail(401, '登录已过期，请重新登录'));
      if (fault === '500') return resolve(fail(500, '服务开小差了，请稍后再试'));
      try { resolve(route(ctx.path, ctx.method, ctx.data || {}, ctx.header || {})); }
      catch (e) { resolve(fail(500, '模拟服务处理出错：' + (e && e.message))); }
    }, delay);
  });
}

module.exports = { handle, route };
