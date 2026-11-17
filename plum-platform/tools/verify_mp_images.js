/**
 * 手机端图片/界面专项验收：不依赖微信开发者工具、不依赖后端。
 *
 *   node tools/verify_mp_images.js
 *
 * 校验：默认 mock 环境所有业务图片都解析为包内本地路径；
 *       离线兜底 getHomeOffline() 可用；图片加载失败能降级到包内图；
 *       本地图已失败时降级为占位块且不会死循环。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../mp-weixin');
let pass = 0, fail = 0;
function check(name, ok, detail) {
  console.log((ok ? '  OK   ' : '  FAIL ') + name + (detail ? ' | ' + detail : ''));
  ok ? pass++ : fail++;
}
function assert(c, m) { if (!c) throw new Error(m || 'assert'); }

const store = {};
global.wx = {
  getStorageSync: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : ''),
  setStorageSync: (k, v) => { store[k] = v; },
  removeStorageSync: (k) => { delete store[k]; },
  getStorageInfoSync: () => ({ keys: Object.keys(store), currentSize: 0, limitSize: 10240 }),
  showToast: () => {}, hideToast: () => {}, showLoading: () => {}, hideLoading: () => {},
  showModal: () => {}, navigateTo: () => {}, switchTab: () => {}, stopPullDownRefresh: () => {},
  request: () => { throw new Error('mock 环境不应发起网络请求'); },
};
global.getCurrentPages = () => [];
global.getApp = () => ({ globalData: {}, setListType() {}, bumpData() {} });

const photos = require(path.join(ROOT, 'utils/photos.js'));
const fallback = require(path.join(ROOT, 'utils/imgFallback.js'));
const api = require(path.join(ROOT, 'services/api.js'));
const config = require(path.join(ROOT, 'config/index.js'));

console.log('\n[1] 包内图片资源');
check('默认仍为 mock 环境', config.getConfig().useMock === true);
check('config.asset() 契约未被改动', config.asset('/assets/a.webp') === '');
const missing = photos.FILES.filter((n) =>
  !fs.existsSync(path.join(ROOT, 'images/photos', n + '.jpg')));
check('清单中每个文件都真实存在', missing.length === 0, missing.join(','));
check('bundled() 映射正确',
  photos.bundled('/assets/banner_01.webp') === '/images/photos/banner_01.jpg');
check('pick() 能按业务类型稳定选图',
  photos.pick({ adult_price: '30.00' }, 2) === '/images/photos/orchard_03.jpg');

console.log('\n[2] 图片加载失败降级');
let patch = null;
const page = { setData: (p) => { patch = p; } };
fallback.call(page, { currentTarget: { dataset: {
  field: 'banners', idx: 0, item: { image: 'http://192.168.1.8:8080/assets/banner_01.webp' },
} } });
check('远程图失败后切到包内同名图',
  patch['banners[0].image'] === '/images/photos/banner_01.jpg', JSON.stringify(patch));
patch = null;
fallback.call(page, { currentTarget: { dataset: {
  field: 'spots.spots', idx: 2, item: { image: '/images/photos/orchard_01.jpg' },
} } });
check('包内图也失败时置空显示占位块', patch['spots.spots[2].image'] === '');
patch = null;
fallback.call(page, { currentTarget: { dataset: { item: { image: '/assets/x.webp' } } } });
check('详情页无 field 时回落到 detail.image', typeof patch['detail.image'] === 'string');

console.log('\n[3] 首页数据链路');
(async () => {
  const home = await api.getHome();
  const imgs = [].concat(
    home.banners.map((b) => b.image),
    home.orchards.map((o) => o.image),
    home.products.map((p) => p.image),
    home.research.map((r) => r.image),
  );
  check('mock 首页拿到全部业务图片', imgs.length > 0, imgs.length + ' 张');
  check('全部为包内本地路径', imgs.every((s) => s.indexOf('/images/photos/') === 0));
  check('全部文件真实存在',
    imgs.every((s) => fs.existsSync(path.join(ROOT, s.replace(/^\//, '')))));
  check('无任何 http(s) 外链', imgs.every((s) => !/^https?:/.test(s)));

  const off = await api.getHomeOffline();
  check('离线兜底数据可用', off.banners.length > 0 && off.orchards.length > 0,
    'banners=' + off.banners.length + ' orchards=' + off.orchards.length);
  check('离线兜底图片同样是包内路径',
    off.banners.every((b) => b.image.indexOf('/images/photos/') === 0));

  console.log('\n----------------------------------------');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('----------------------------------------');
  if (fail) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
