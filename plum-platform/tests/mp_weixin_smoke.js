/**
 * 游客小程序离线验收：不依赖微信开发者工具，也不需要启动 Python 服务。
 * 运行：node tests/mp_weixin_smoke.js
 *
 * 覆盖：工程结构与页面完整性、模块导出、WXML 事件绑定、
 *       配置化请求层 → 本地模拟服务端 → 业务 API 的完整链路（含分页/鉴权/幂等/故障注入）。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../mp-weixin');
let pass = 0;
let fail = 0;

function check(name, fn) {
  try {
    if (fn() === false) throw new Error('断言返回 false');
    pass += 1;
    console.log('  OK   ' + name);
  } catch (e) {
    fail += 1;
    console.log('  FAIL ' + name + ' -> ' + (e && e.message));
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
function readJson(rel) { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
function readText(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// ---------- 用最小 wx 实现跑通小程序模块 ----------
const store = {};
const toasts = [];
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(store), currentSize: 2, limitSize: 10240 }),
  showToast: (o) => { toasts.push(o.title || ''); },
  hideToast: () => {},
  showLoading: () => {},
  hideLoading: () => {},
  showModal: () => {},
  stopPullDownRefresh: () => {},
  setNavigationBarTitle: () => {},
  navigateTo: () => {},
  navigateBack: () => {},
  switchTab: () => {},
  request: () => { throw new Error('mock 环境不应调用 wx.request'); },
};
global.getCurrentPages = () => [];
global.getApp = () => ({
  globalData: { listType: 'product', dataVersion: 0, justLoggedIn: 0 },
  setListType() {}, bumpData() {},
});

console.log('\n[1] 工程结构与页面完整性');

let appJson = null;
check('app.json 可解析且注册了页面', () => {
  appJson = readJson('app.json');
  assert(Array.isArray(appJson.pages) && appJson.pages.length >= 4, 'pages 缺失');
  return true;
});

check('tabBar 的 pagePath 都在 pages 中', () => {
  (appJson.tabBar.list || []).forEach((t) => {
    assert(appJson.pages.indexOf(t.pagePath) >= 0, 'tabBar 页面未注册：' + t.pagePath);
  });
  return true;
});

check('每个页面四个同名文件齐全', () => {
  appJson.pages.forEach((p) => {
    ['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
      const f = path.join(ROOT, p + ext);
      assert(fs.existsSync(f), '缺少 ' + p + ext);
    });
    const j = readJson(p + '.json');
    assert(typeof j === 'object', p + '.json 非法');
  });
  return true;
});

check('工程配置与 sitemap 合法', () => {
  const pc = readJson('project.config.json');
  assert(pc.miniprogramRoot === './', 'miniprogramRoot 应为 ./');
  assert(pc.setting && pc.setting.urlCheck === false, '需关闭域名校验以支持 local 环境');
  readJson(appJson.sitemapLocation);
  return true;
});

check('旧页面已清理，app.json 无残留引用', () => {
  ['pages/orchard/orchard', 'pages/shop/shop'].forEach((p) => {
    assert(appJson.pages.indexOf(p) < 0, '仍注册了旧页面 ' + p);
    assert(!fs.existsSync(path.join(ROOT, p + '.js')), '仍存在旧文件 ' + p + '.js');
  });
  return true;
});

console.log('\n[2] 模块与页面脚本');

const config = require(path.join(ROOT, 'config/index.js'));
const cache = require(path.join(ROOT, 'utils/cache.js'));
const auth = require(path.join(ROOT, 'utils/auth.js'));
const request = require(path.join(ROOT, 'utils/request.js'));
const api = require(path.join(ROOT, 'services/api.js'));
const mockServer = require(path.join(ROOT, 'mock/server.js'));
const D = require(path.join(ROOT, 'mock/data.js'));

check('配置层导出完整且默认 mock 环境', () => {
  ['getConfig', 'getEnvList', 'setEnv', 'setLanBase', 'getFault', 'setFault', 'asset']
    .forEach((k) => assert(typeof config[k] === 'function', '缺少 ' + k));
  assert(config.getConfig().useMock === true, '默认应为 mock');
  assert(config.getConfig().baseUrl === '', 'mock 环境不应有 baseUrl');
  assert(config.asset('/assets/a.webp') === '', 'mock 环境图片应返回空串');
  return true;
});

check('三种环境可切换，局域网地址可配置', () => {
  const list = config.getEnvList();
  assert(list.length === 3, '应有 mock/local/lan 三种环境');
  assert(config.setEnv('local') && config.getConfig().baseUrl.indexOf('127.0.0.1') >= 0, 'local 切换失败');
  assert(config.setLanBase('http://10.0.0.9:8080/'), 'lan 地址格式校验失败');
  assert(config.getEnvList()[2].baseUrl === 'http://10.0.0.9:8080', 'lan 地址未生效');
  assert(!config.setLanBase('not-a-url'), '非法地址应被拒绝');
  assert(config.setEnv('mock'), '切回 mock 失败');
  return true;
});

check('缓存层 TTL / 保留清理生效', () => {
  cache.set('a', 1, 0);
  cache.set('b', 2, 0);
  assert(cache.get('a') === 1, '缓存读不到');
  cache.set('expired', 9, -1);
  assert(cache.get('expired') === 9, 'ttl=0 应永不过期');
  cache.clearExcept(['a']);
  assert(cache.get('a') === 1, '保留项被误删');
  assert(cache.get('b') === null, '未保留项未清掉');
  cache.clear();
  return true;
});

check('请求层与业务 API 导出完整', () => {
  ['get', 'post', 'put', 'del', 'request', 'RequestError']
    .forEach((k) => assert(request[k], 'request 缺少 ' + k));
  ['authLogin', 'getHome', 'getList', 'getDetail', 'createOrder', 'payOrder',
    'createReservation', 'signupResearch', 'bookHomestay', 'getMyOverview',
    'getMyOrders', 'getMyReservations', 'getCheckinSpots', 'checkin', 'aiChat']
    .forEach((k) => assert(typeof api[k] === 'function', 'api 缺少 ' + k));
  assert(typeof mockServer.handle === 'function' && typeof mockServer.route === 'function',
    'mock server 导出不完整');
  return true;
});

check('模拟数据条数足够分页验收', () => {
  assert(D.orchards.length >= 10 && D.products.length >= 10, '园区/商品不足 10 条');
  assert(D.accounts.length >= 4 && D.checkinSpots.length >= 4, '账号/点位数据不足');
  return true;
});

check('所有页面脚本可加载，WXML 事件均有对应方法', () => {
  let pageDef = null;
  global.Page = (def) => { pageDef = def; };
  appJson.pages.forEach((p) => {
    pageDef = null;
    delete require.cache[require.resolve(path.join(ROOT, p + '.js'))];
    require(path.join(ROOT, p + '.js'));
    assert(pageDef, p + ' 未调用 Page()');
    const wxml = readText(p + '.wxml');
    const re = /\b(?:bind|catch):?([a-zA-Z]+)\s*=\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(wxml)) !== null) {
      const handler = m[2].trim();
      if (handler.indexOf('{{') >= 0) continue;
      assert(typeof pageDef[handler] === 'function',
        p + '.wxml 的 ' + m[1] + '="' + handler + '" 在 ' + p + '.js 中没有实现');
    }
  });
  return true;
});

check('WXML 不含复杂 JS 表达式（兼容低版本基础库）', () => {
  appJson.pages.forEach((p) => {
    const wxml = readText(p + '.wxml');
    ['.indexOf(', '.filter(', '.map(', '.toFixed(', '% 4 +'].forEach((bad) => {
      assert(wxml.indexOf(bad) < 0, p + '.wxml 含复杂表达式 ' + bad);
    });
  });
  return true;
});

check('WXML 标签闭合且层级配对', () => {
  const VOID = ['image', 'input', 'icon', 'import', 'include', 'wxs', 'progress'];
  appJson.pages.forEach((p) => {
    const wxml = readText(p + '.wxml').replace(/<!--[\s\S]*?-->/g, '');
    const stack = [];
    const re = /<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g;
    let m;
    while ((m = re.exec(wxml)) !== null) {
      const closing = m[1] === '/';
      const tag = m[2];
      const self = m[4] === '/';
      if (closing) {
        const top = stack.pop();
        assert(top === tag, p + '.wxml 标签错配：期望 </' + top + '>，实际 </' + tag + '>');
      } else if (!self && VOID.indexOf(tag) < 0) {
        stack.push(tag);
      }
    }
    assert(stack.length === 0, p + '.wxml 有未闭合标签：' + stack.join(','));
  });
  return true;
});

console.log('\n[3] 模拟服务端接口契约');

const route = mockServer.route;
const call = (method, url, data, sid) =>
  route(url, method, data || {}, sid ? { 'X-Session-Id': sid } : {});

check('首页 / 列表 / 详情返回 200 且字段齐全', () => {
  const home = call('GET', '/api/home');
  assert(home.code === 200 && home.data.banners.length && home.data.orchards.length, 'home 数据不全');
  const p1 = call('GET', '/api/orchards', { pageNum: 1, pageSize: 5 });
  assert(p1.code === 200 && p1.data.records.length === 5 && p1.data.total === D.orchards.length,
    '园区分页不对');
  const p3 = call('GET', '/api/orchards', { pageNum: 3, pageSize: 5 });
  assert(p3.data.records.length === D.orchards.length - 10, '园区末页不对');
  const kw = call('GET', '/api/orchards', { pageNum: 1, pageSize: 10, keyword: '青梅谷' });
  assert(kw.data.records.length === 1, '关键词过滤不对');
  const cat = call('GET', '/api/products', { pageNum: 1, pageSize: 50, category_id: 1 });
  assert(cat.data.records.every((x) => x.category_id === 1), '分类过滤不对');
  assert(Array.isArray(call('GET', '/api/research').data), '研学应返回数组');
  const detail = call('GET', '/api/orchards/1');
  assert(detail.code === 200 && detail.data.sessions.length === 6, '详情场次缺失');
  assert(call('GET', '/api/orchards/9999').code === 404, '不存在的详情应 404');
  return true;
});

check('登录校验角色、错误口令与登出失效', () => {
  assert(call('POST', '/api/auth/login', { username: 'tourist01', password: 'bad' }).code === 401,
    '错误口令应 401');
  assert(call('POST', '/api/auth/login',
    { username: 'admin', password: 'admin123', role: '游客' }).code === 403,
    '管理员账号不应能从游客端登录');
  const login = call('POST', '/api/auth/login',
    { username: 'tourist01', password: 'tourist123', role: '游客' });
  assert(login.code === 200 && login.data.role === '游客' && login.data.sessionId, '游客登录失败');
  assert(call('GET', '/api/my/orders', {}, 'bad-session').code === 401, '伪造会话应 401');
  assert(call('POST', '/api/auth/logout', {}, login.data.sessionId).code === 200, '登出失败');
  assert(call('GET', '/api/my/orders', {}, login.data.sessionId).code === 401, '登出后会话仍有效');
  assert(call('POST', '/api/auth/login',
    { username: 'tourist01', password: 'tourist123', role: '游客' }).code === 200,
    '重新登录失败');
  return true;
});

const sid = 'mock-session-4';
let orderId = 0;

check('未登录写操作被拦截，登录后下单并支付成功', () => {
  assert(call('POST', '/api/orders', { receiver: '小梅' }).code === 401, '未登录下单应 401');
  const payload = {
    requestId: 'selftest-order-1', receiver: '小梅', phone: '13700000001',
    address: '大邑县䢺江镇游客中心', items: [{ product_id: 2, quantity: 2 }],
  };
  const a = call('POST', '/api/orders', payload, sid);
  assert(a.code === 200 && a.data.order_no && a.data.status === '待支付', '下单失败');
  const b = call('POST', '/api/orders', payload, sid);
  assert(b.data.id === a.data.id, 'requestId 幂等未生效');
  orderId = a.data.id;
  assert(call('POST', '/api/orders/' + orderId + '/pay', {}, sid).data.status === '已支付', '支付失败');
  assert(call('POST', '/api/orders/' + orderId + '/pay', {}, sid).code === 409, '重复支付应 409');
  return true;
});

check('预约 / 报名 / 订房 / 集章均返回核销码', () => {
  const r = call('POST', '/api/reservations', {
    requestId: 'selftest-res-1', session_id: 1, people: 2,
    contact: '小梅', phone: '13700000001',
  }, sid);
  assert(r.code === 200 && r.data.checkin_code && r.data.code, '采摘预约失败');
  const s = call('POST', '/api/research/signup', {
    requestId: 'selftest-sign-1', research_id: 1, people: 1,
    contact: '小梅', phone: '13700000001',
  }, sid);
  assert(s.code === 200 && s.data.checkin_code, '研学报名失败');
  const h = D.homestays[0];
  const b = call('POST', '/api/homestay-bookings', {
    requestId: 'selftest-stay-1', homestay_id: h.id, room_id: h.rooms[0].id,
    guests: 1, check_in: '2026-12-01', check_out: '2026-12-02',
    contact: '小梅', phone: '13700000001',
  }, sid);
  assert(b.code === 200 && b.data.checkin_code, '民宿预订失败：' + b.msg);
  assert(call('POST', '/api/checkin', { spot_id: 3 }).code === 401, '未登录盖章应 401');
  const c = call('POST', '/api/checkin', { spot_id: 3 }, sid);
  assert(c.code === 200 && c.data.stamped === 3, '盖章失败');
  assert(call('POST', '/api/checkin', { spot_id: 3 }, sid).code === 409, '重复盖章应 409');
  return true;
});

check('我的总览返回真实登录账号且单据计数增长', () => {
  const ov = call('GET', '/api/my/overview', {}, sid);
  assert(ov.code === 200 && ov.data.nickname === '小梅' && ov.data.role === '游客', '昵称/角色不对');
  assert(ov.data.counts.orders >= 4 && ov.data.counts.reservations >= 3, '单据计数没涨');
  assert(ov.data.bookings.length > 0, '核销码列表为空');
  assert(call('GET', '/api/my/orders', {}, sid).data.length >= 4, '我的订单缺失');
  assert(call('GET', '/api/my/reservations', {}, sid).data.length >= 3, '我的预约缺失');
  assert(call('GET', '/api/checkin-spots').data.stamped === 3, '集章进度不对');
  return true;
});

check('本地 AI 三项能力返回真实业务数据', () => {
  const chat = call('POST', '/api/ai/chat', { question: '青梅酒多少钱？' });
  assert(chat.code === 200 && chat.data.answer.indexOf('青梅酒') >= 0, 'AI 客服没用上业务数据');
  const plan = call('POST', '/api/ai/itinerary', { days: 2 });
  assert(plan.code === 200 && plan.data.itinerary.indexOf('第二天') >= 0, '两日行程缺失');
  const tts = call('POST', '/api/ai/tts', { target_id: 1, target_type: 'orchard' });
  assert(tts.code === 200 && tts.data.segments.length === 3, '讲解稿缺失');
  return true;
});

async function checkAsync(name, fn) {
  try {
    if ((await fn()) === false) throw new Error('断言返回 false');
    pass += 1;
    console.log('  OK   ' + name);
  } catch (e) {
    fail += 1;
    console.log('  FAIL ' + name + ' -> ' + (e && e.message));
  }
}

async function main() {
  console.log('\n[4] 配置化请求层 → 业务 API 异步链路');

  await checkAsync('登录 → 首页 → 分页 → 详情 → 我的 → 下单支付 → 集章', async () => {
    const d = await api.authLogin({ username: 'tourist01', password: 'tourist123', role: '游客' });
    assert(d.sessionId && d.role === '游客', '登录返回不完整');
    auth.setSession(d);
    assert(auth.checkLogin() && auth.hasRole('游客'), '会话未落地');
    const home = await api.getHome();
    assert(home.banners.length && home.orchards.length, '首页数据缺失');
    const list = await api.getList('product', { pageNum: 2, pageSize: 5 });
    assert(list.records.length === 5 && list.total === D.products.length, '商品分页不对');
    assert(list.records[0].imageText, '图片占位文本缺失');
    const detail = await api.getDetail('orchard', 2);
    assert(detail.sessions.length === 6, '详情场次缺失');
    const ov = await api.getMyOverview();
    assert(ov.nickname === '小梅' && ov.counts.orders > 0, '我的总览不对');
    const order = await api.createOrder({
      receiver: '小梅', phone: '13700000001', address: '大邑县䢺江镇',
      items: [{ product_id: 3, quantity: 1 }],
    });
    assert(order.order_no, '创建订单失败');
    const paid = await api.payOrder(order.id);
    assert(paid.status === '已支付', '支付失败');
    const spots = await api.getCheckinSpots();
    assert(spots.spots.length === D.checkinSpots.length, '点位数据缺失');
    await api.checkin(4);
    const spots2 = await api.getCheckinSpots();
    assert(spots2.stamped === spots.stamped + 1, '盖章后进度没涨');
    return true;
  });

  await checkAsync('故障注入：网络断开 → 重试后失败并提示', async () => {
    config.setFault('network');
    let err = null;
    try { await api.getHome(); } catch (e) { err = e; }
    config.setFault('');
    assert(err && err.retryable, '网络故障应抛出可重试错误');
    assert(toasts.some((t) => t.indexOf('网络') >= 0), '应给出网络错误提示');
    return true;
  });

  await checkAsync('故障注入：401 清会话并广播一次', async () => {
    let broadcast = 0;
    auth.onUnauthorized(() => { broadcast += 1; });
    config.setFault('401');
    let code = 0;
    try { await api.getMyOverview(); } catch (e) { code = e.code; }
    config.setFault('');
    assert(code === 401, '应抛出 401');
    assert(broadcast === 1, '401 广播次数不对');
    assert(auth.checkLogin() === false, '401 未清除会话');
    config.setFault('401');
    const relogin = await api.authLogin(
      { username: 'tourist01', password: 'tourist123', role: '游客' });
    config.setFault('');
    assert(relogin.sessionId, '故障注入时登录接口不应被拦截');
    return true;
  });

  await checkAsync('恢复正常后请求层可继续使用', async () => {
    const d = await api.authLogin({ username: 'tourist01', password: 'tourist123', role: '游客' });
    auth.setSession(d);
    const home = await api.getHome();
    assert(home.products.length > 0, '恢复后首页仍不可用');
    await api.logout();
    auth.clear();
    return true;
  });

  console.log('\n----------------------------------------');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('----------------------------------------\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error('自测脚本异常：', e);
  process.exit(1);
});
