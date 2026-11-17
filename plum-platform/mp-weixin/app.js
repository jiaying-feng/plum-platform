const config = require('./config/index.js');
const auth = require('./utils/auth.js');

let lastUnauthorized = 0;

App({
  globalData: {
    env: 'mock',
    listType: 'product',
    fromDetailBack: false,
    dataVersion: 0,
    justLoggedIn: 0,
  },

  onLaunch() {
    this.globalData.env = config.getConfig().key;

    // 401 统一处理：并发请求可能同时失败，30 秒内只跳一次登录页，
    // 留出时间在「我的 → 设置」里关掉故障注入或切换数据源，避免反复跳转。
    auth.onUnauthorized(() => {
      const now = Date.now();
      if (now - lastUnauthorized < 30000) return;
      lastUnauthorized = now;
      const pages = getCurrentPages();
      const current = pages.length ? pages[pages.length - 1].route : '';
      if (current === 'pages/login/login') return;
      wx.navigateTo({ url: '/pages/login/login' });
    });
  },

  onShow() {
    this.globalData.env = config.getConfig().key;
  },

  /** tabBar 页面之间无法用 URL 传参，用 globalData 传递列表分类 */
  setListType(type) {
    this.globalData.listType = type;
  },

  /** 下单 / 预约 / 盖章成功后递增，个人中心 onShow 据此刷新 */
  bumpData() {
    this.globalData.dataVersion = (this.globalData.dataVersion || 0) + 1;
  },

  /** 登录成功后允许再次响应 401，避免旧的节流窗口影响新会话 */
  resetUnauthorized() { lastUnauthorized = 0; },
});
