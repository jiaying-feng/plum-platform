/**
 * 本地模拟数据。字段、命名、金额格式与 server/db.py 及 /api 返回保持一致，
 * 因此 mock 与真实模式可以用同一套页面代码，互不感知。
 * image 统一留空：由页面渲染统一规格的占位块，不依赖任何外部图片服务。
 */
const ORCHARD_NAMES = [
  '䢺江青梅采摘园', '青梅谷生态果园', '梅香坡家庭农场', '大双路青梅园', '山顶老梅林',
  '青梅溪畔果园', '老街后山梅园', '石桥青梅合作社', '云雾山梅林', '梅子沟果园',
  '向阳坡采摘园', '竹林青梅园', '龙潭子梅林', '半山梅香农场',
];
const TOWNS = ['䢺江镇', '安仁镇', '西岭镇', '䢺江镇'];
const PRODUCT_NAMES = [
  '新鲜青梅果 5斤装', '古法青梅酒 500ml', '青梅蜜饯 200g', '话梅干 150g',
  '青梅酱 280g', '五年陈酿礼盒', '青梅气泡水 6瓶', '手作梅子糖',
  '青梅醋 500ml', '梅香茶叶礼盒', '青梅果脯大礼包', '自酿青梅酒 2.5L',
  '青梅蜂蜜 250g', '梅子冰粉套装', '青梅酥 12枚', '老坛青梅酒 1L',
  '青梅果茶 10包', '梅干菜 300g', '青梅润喉糖', '梅子酱礼盒',
  '鲜摘青梅 2斤装', '青梅酒小瓶装', '梅香手工皂', '青梅文创帆布袋',
];
const RESEARCH_TITLES = [
  '古法青梅酒酿造体验', '亲子梅子酱手作课', '从枝头到酒坛 · 半日研学',
  '青梅酥烘焙课', '梅园自然观察课', '老酒坊开坛仪式体验',
  '青梅蜜饯制作课', '山间草木染体验',
];
const HOMESTAY_NAMES = [
  '梅香居民宿', '山语间农庄', '青梅小院', '溪畔人家', '老街客栈',
  '半山梅居', '竹里馆', '云上梅舍', '梅园别院',
];
const FESTIVALS = [
  { title: '青梅采摘节', festival_date: '6月上旬 09:00-17:00', place: '䢺江镇青梅广场', intro: '梅子熟了，来园子里摘一篮，晚上还有坝坝宴。' },
  { title: '开坛品酒会', festival_date: '7月中旬 14:00-17:00', place: '古镇老街酒坊', intro: '老师傅开五年陈酿，五种年份慢慢品。' },
  { title: '梅园研学周', festival_date: '8月每周六', place: '青梅研学基地', intro: '带娃封一罐属于自己的青梅酒，写上名字带走。' },
  { title: '冬日梅香集市', festival_date: '12月下旬', place: '䢺江镇老街', intro: '蜜饯、果酒、梅子酱，年货一次备齐。' },
];
const SEASON_TIPS = [
  { month_range: '3月—5月', title: '来喝一坛酒', content: '花刚谢，梅子刚坐果，山里凉快，老酒坊正好开坛。', tag: '春' },
  { month_range: '6月—8月', title: '梅子熟了，上山走走', content: '带件防晒衣，上午果子带露，摘完坐着喝杯青梅茶。', tag: '夏' },
  { month_range: '9月—12月', title: '新酒封坛，老酒开坛', content: '酒坊可以试五种年份，慢慢品，喜欢哪坛带哪坛。', tag: '秋' },
  { month_range: '1月—2月', title: '围炉煮梅茶', content: '山里冷，来镇上烤火，喝杯热梅茶，顺手备点年货。', tag: '冬' },
];

const orchards = ORCHARD_NAMES.map((name, i) => ({
  id: i + 1, name, town: TOWNS[i % TOWNS.length],
  address: '大邑县' + TOWNS[i % TOWNS.length] + '青梅村' + (i + 1) + '组',
  lng: 103.42 + i * 0.009, lat: 30.58 + i * 0.006,
  open_time: '08:30-17:30', adult_price: (30 + i % 3 * 5).toFixed(2),
  child_price: (15 + i % 3 * 3).toFixed(2),
  intro: '自家果园，梅子熟了就能来摘。园里地势平缓，小孩子也走得动，摘完还能坐着喝杯青梅茶。',
  image: '', audit_status: '已通过',
}));

const categories = [
  { id: 1, name: '青梅鲜果', sort: 1, status: '启用' },
  { id: 2, name: '青梅加工', sort: 2, status: '启用' },
  { id: 3, name: '青梅酒水', sort: 3, status: '启用' },
  { id: 4, name: '文创周边', sort: 4, status: '启用' },
];

const products = PRODUCT_NAMES.map((name, i) => ({
  id: i + 1, name, subtitle: ['自家做的，卖完等下一季', '镇上老手艺', '带走送人都合适'][i % 3],
  price: (18 + (i * 13) % 160 + 0.9).toFixed(2),
  stock: 5 + (i * 7) % 90, sales: 3 + (i * 11) % 120,
  image: '', intro: '选的是本地青梅，做法还是老一辈传下来的，甜里带点酸，配茶正好。',
  category_id: (i % 4) + 1, audit_status: '已通过', shelf_status: '上架',
}));

const research = RESEARCH_TITLES.map((title, i) => ({
  id: i + 1, title, start_date: '2026-11-' + String(12 + i).padStart(2, '0'),
  end_date: '2026-12-' + String(1 + i).padStart(2, '0'),
  price: (68 + i * 20).toFixed(2), capacity: 12 + i * 2, signed: i === 4 ? 12 + i * 2 : 3 + i,
  intro: '跟着老师傅从头做一遍，亲手封一罐，写上名字带走。', image: '',
  audit_status: '已通过', status: '报名中',
}));

const homestays = HOMESTAY_NAMES.map((name, i) => ({
  id: i + 1, name, town: TOWNS[i % TOWNS.length],
  address: '大邑县' + TOWNS[i % TOWNS.length] + '古镇街' + (i * 3 + 8) + '号',
  intro: '推窗就是梅园，早上能听见鸟叫。院子里可以坐着喝茶，老板娘会做青梅排骨。',
  image: '', audit_status: '已通过',
  rooms: [
    { id: i * 2 + 1, name: '梅景大床房', capacity: 2, price: (280 + i * 20).toFixed(2), stock: 2 + i % 4 },
    { id: i * 2 + 2, name: '院子双床房', capacity: 3, price: (360 + i * 20).toFixed(2), stock: 1 + i % 3 },
  ],
}));

const festivals = FESTIVALS.map((f, i) => Object.assign({ id: i + 1, image: '', status: '展示中' }, f));

const checkinSpots = [
  { id: 1, name: '游客中心', spot_type: '服务', intro: '先来这儿领一张手绘地图。', badge: '第一枚' },
  { id: 2, name: '老街酒坊', spot_type: '体验', intro: '看老师傅开坛，能试五种年份。', badge: '酒香' },
  { id: 3, name: '青梅广场', spot_type: '地标', intro: '节庆都在这儿办，晚上有坝坝宴。', badge: '热闹' },
  { id: 4, name: '山顶老梅林', spot_type: '风景', intro: '地势平缓，看得见整片山谷。', badge: '视野' },
  { id: 5, name: '研学基地', spot_type: '体验', intro: '亲手封一罐酒，写上名字。', badge: '手作' },
  { id: 6, name: '溪畔果园', spot_type: '采摘', intro: '梅子熟了，上午带露最好摘。', badge: '当季' },
].map((s) => Object.assign(s, { lng: 103.42 + s.id * 0.01, lat: 30.58 + s.id * 0.007, image: '', stamped: s.id <= 2 }));

const orders = [
  { id: 1, order_no: 'PM202611100001', amount: '128.00', status: '已支付', created_at: '2026-11-10 09:20', receiver: '小梅', phone: '13700000001', items: [{ name: '古法青梅酒 500ml', quantity: 1, price: '128.00' }] },
  { id: 2, order_no: 'PM202611090002', amount: '57.80', status: '已发货', created_at: '2026-11-09 15:40', receiver: '小梅', phone: '13700000001', items: [{ name: '青梅蜜饯 200g', quantity: 2, price: '18.90' }] },
  { id: 3, order_no: 'PM202611080003', amount: '39.90', status: '已完成', created_at: '2026-11-08 11:05', receiver: '小梅', phone: '13700000001', items: [{ name: '新鲜青梅果 5斤装', quantity: 1, price: '39.90' }] },
];

const reservations = [
  { id: 1, code: 'YY202611100001', orchard_name: '䢺江青梅采摘园', visit_date: '2026-11-13', slot: '上午 09:00-11:30', people: 2, amount: '60.00', status: '待核销', checkin_code: 'CK0000000A01' },
  { id: 2, code: 'YY202611090002', orchard_name: '青梅谷生态果园', visit_date: '2026-11-12', slot: '下午 14:00-16:30', people: 3, amount: '105.00', status: '已核销', checkin_code: 'CK0000000A02' },
];

const accounts = [
  { username: 'tourist01', password: 'tourist123', userId: 4, nickname: '小梅', role: '游客' },
  { username: 'farmer01', password: 'merchant123', userId: 2, nickname: '青梅园老李', role: '商户' },
  { username: 'stay01', password: 'merchant123', userId: 3, nickname: '梅香居民宿', role: '商户' },
  { username: 'admin', password: 'admin123', userId: 1, nickname: '镇平台管理员', role: '管理员' },
];

module.exports = {
  orchards, products, research, homestays, festivals, categories, seasonTips: SEASON_TIPS,
  checkinSpots, orders, reservations, accounts,
  banners: ['/assets/banner_01.webp', '/assets/banner_02.webp', '/assets/banner_03.webp', '/assets/banner_04.webp'],
};
