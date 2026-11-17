/**
 * 登录页：真实调用 /api/auth/login，成功后写入本端会话。
 * 只接受「游客」角色，从前端再挡一次非游客账号，避免游客端串显管理员昵称。
 */
const api = require('../../services/api.js');
const auth = require('../../utils/auth.js');
const config = require('../../config/index.js');

Page({
  data: {
    username: '', password: '', showPwd: false, busy: false, error: '',
  },

  onUser(e) { this.setData({ username: e.detail.value, error: '' }); },
  onPwd(e) { this.setData({ password: e.detail.value, error: '' }); },
  togglePwd() { this.setData({ showPwd: !this.data.showPwd }); },

  submit() {
    if (this.data.busy) return;
    const username = String(this.data.username || '').trim();
    const password = String(this.data.password || '');
    if (!username || !password) {
      this.setData({ error: '账号和口令都要填' });
      return;
    }
    this.setData({ busy: true, error: '' });
    wx.showLoading({ title: '正在登录', mask: true });

    api.authLogin({ username, password, role: '游客' }).then((d) => {
      if (!d || !d.sessionId) throw new Error('登录没拿到会话，再试一次');
      if (d.role && d.role !== '游客') {
        throw new Error('这是游客端，请换游客账号登录');
      }
      auth.setSession(d);
      const app = getApp();
      app.globalData.justLoggedIn = Date.now();
      app.globalData.env = config.getConfig().key;
      if (typeof app.resetUnauthorized === 'function') app.resetUnauthorized();
      wx.hideLoading();
      wx.showToast({ title: '回来了，' + d.nickname, icon: 'none' });
      this.back();
    }).catch((e) => {
      auth.clear();
      wx.hideLoading();
      const msg = (e && e.message) || '没登上去，稍后再试';
      this.setData({ busy: false, error: msg });
      wx.showToast({ title: msg, icon: 'none' });
    });
  },

  back() {
    setTimeout(() => {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack({ delta: 1 });
      else wx.switchTab({ url: '/pages/mine/mine' });
    }, 500);
  },

  skip() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack({ delta: 1 });
    else wx.switchTab({ url: '/pages/index/index' });
  },
});
