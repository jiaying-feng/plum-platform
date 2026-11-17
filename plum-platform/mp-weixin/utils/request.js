/**
 * 可替换的配置化请求封装。
 *
 * - 传输层可替换：useMock=true 走 mock/server.js，否则走 wx.request；业务层完全不感知。
 * - 统一注入 X-Session-Id；统一解包 {code,msg,data}；统一错误码处理；网络失败自动重试一次。
 * - 401 自动清除登录态并广播，由 app.js 统一跳转登录页。
 */
const config = require('../config/index.js');
const auth = require('./auth.js');
const mockServer = require('../mock/server.js');

class RequestError extends Error {
  constructor(code, message, retryable) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
    this.retryable = !!retryable;
  }
}

function wxRequest(url, method, data, header, timeout) {
  return new Promise((resolve, reject) => {
    wx.request({
      url, method, data, header, timeout,
      success: (res) => resolve({ statusCode: res.statusCode, body: res.data }),
      fail: () => reject(new RequestError(0, '连不上服务，检查地址和网络', true)),
    });
  });
}

function unwrap(body, silent) {
  if (body && body.code === 200) return body.data === undefined ? {} : body.data;
  const code = (body && body.code) || 500;
  const msg = (body && body.msg) || '服务返回了看不懂的内容';
  if (code === 401) {
    auth.emitUnauthorized(msg);
    if (!silent) wx.showToast({ title: '登录已过期，请重新登录', icon: 'none' });
  } else if (!silent) {
    wx.showToast({ title: msg, icon: 'none' });
  }
  throw new RequestError(code, msg, code >= 500);
}

function request(options) {
  const o = options || {};
  const path = o.path;
  const method = (o.method || 'GET').toUpperCase();
  const payload = o.data || {};
  const cfg = config.getConfig();

  if (o.needAuth && !auth.checkLogin()) {
    return Promise.reject(new RequestError(401, '请先登录，再接着办'));
  }

  const header = { 'Content-Type': 'application/json' };
  const token = auth.getToken();
  if (token) header['X-Session-Id'] = token;

  const total = o.retry === undefined ? 1 : o.retry;
  const run = (left) => {
    const task = cfg.useMock
      ? mockServer.handle({ path, method, data: payload, header })
      : wxRequest(cfg.baseUrl + path, method, payload, header, cfg.timeout)
        .then((res) => {
          if (res.statusCode >= 400 && !(res.body && res.body.code)) {
            return {
              code: res.statusCode,
              msg: (res.body && res.body.msg) || ('HTTP ' + res.statusCode),
              data: null,
            };
          }
          return res.body;
        });

    return task
      .then((body) => unwrap(body, o.silent))
      .catch((err) => {
        const e = err instanceof RequestError
          ? err : new RequestError(500, String(err && err.message || err), true);
        if (left > 0 && e.retryable) return run(left - 1);
        if (e.retryable && !o.silent) {
          wx.showToast({ title: '网络不太稳，稍后再试', icon: 'none' });
        }
        throw e;
      });
  };
  return run(total);
}

const get = (path, query, opt) => request(Object.assign({ path, method: 'GET', data: query || {} }, opt));
const post = (path, body, opt) => request(Object.assign({ path, method: 'POST', data: body || {} }, opt));
const put = (path, body, opt) => request(Object.assign({ path, method: 'PUT', data: body || {} }, opt));
const del = (path, body, opt) => request(Object.assign({ path, method: 'DELETE', data: body || {} }, opt));

module.exports = { request, get, post, put, del, RequestError };
