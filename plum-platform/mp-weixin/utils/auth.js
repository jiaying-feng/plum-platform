/**
 * 登录鉴权：只负责会话的存取、有效期与登录态事件，不发起网络请求（避免与 request 循环依赖）。
 * 真正的登录请求放在 services/api.js，页面拿到结果后调用 setSession。
 */
const K_TOKEN = 'plum_token';
const K_USER = 'plum_user_info';
const TTL_SECONDS = 7 * 24 * 3600;

let listeners = [];

function put(key, value) {
  try {
    wx.setStorageSync(key, { v: value, e: Date.now() + TTL_SECONDS * 1000 });
  } catch (e) { /* noop */ }
}
function take(key) {
  try {
    const raw = wx.getStorageSync(key);
    if (!raw || !raw.e || raw.e < Date.now()) {
      wx.removeStorageSync(key);
      return null;
    }
    return raw.v;
  } catch (e) { return null; }
}

function setSession(data) {
  put(K_TOKEN, data.sessionId);
  const user = {
    userId: data.userId, nickname: data.nickname, role: data.role, loginAt: Date.now(),
  };
  put(K_USER, user);
  return user;
}
function getToken() {
  const t = take(K_TOKEN);
  return typeof t === 'string' && t ? t : '';
}
function getUser() { return take(K_USER) || null; }
function checkLogin() { return !!(getToken() && getUser()); }
function hasRole() {
  const u = getUser();
  if (!u) return false;
  for (let i = 0; i < arguments.length; i++) if (u.role === arguments[i]) return true;
  return false;
}
function clear() {
  try { wx.removeStorageSync(K_TOKEN); wx.removeStorageSync(K_USER); } catch (e) { /* noop */ }
}
function onUnauthorized(fn) {
  if (typeof fn === 'function' && listeners.indexOf(fn) < 0) listeners.push(fn);
}
function emitUnauthorized(msg) {
  clear();
  listeners.forEach((fn) => { try { fn(msg); } catch (e) { /* noop */ } });
}
function requireLogin() {
  if (checkLogin()) return true;
  wx.navigateTo({ url: '/pages/login/login' });
  return false;
}

module.exports = {
  setSession, getToken, getUser, checkLogin, hasRole, clear,
  onUnauthorized, emitUnauthorized, requireLogin,
};
