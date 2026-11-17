/**
 * 全局配置：所有接口地址、环境、超时、分页大小、缓存时长集中在这里。
 *
 * 默认 useMock=true，导入微信开发者工具即可运行，不依赖任何后端服务。
 * 切换到 local / lan 后走真实 wx.request，只需在开发者工具勾选「不校验合法域名」。
 * 运行时切换：require('../../config/index.js').setEnv('local')
 */
const K_ENV = 'plum_env';
const K_LAN = 'plum_lan_base';
const K_FAULT = 'plum_mock_fault';

const ENVS = {
  mock: {
    key: 'mock', name: '本地模拟数据（无需后端）', useMock: true,
    baseUrl: '', timeout: 8000, pageSize: 10, cacheTTL: 300,
  },
  local: {
    key: 'local', name: '本机服务 127.0.0.1:8080', useMock: false,
    baseUrl: 'http://127.0.0.1:8080', timeout: 8000, pageSize: 10, cacheTTL: 300,
  },
  lan: {
    key: 'lan', name: '局域网服务（真机预览）', useMock: false,
    baseUrl: 'http://192.168.1.8:8080', timeout: 8000, pageSize: 10, cacheTTL: 300,
  },
};

function read(key, fallback) {
  try { return wx.getStorageSync(key) || fallback; } catch (e) { return fallback; }
}
function write(key, value) {
  try { wx.setStorageSync(key, value); } catch (e) { /* 存储不可用时不阻塞业务 */ }
}

let current = read(K_ENV, 'mock');
if (!ENVS[current]) current = 'mock';
ENVS.lan.baseUrl = read(K_LAN, ENVS.lan.baseUrl);
let fault = read(K_FAULT, '');

function getConfig() {
  const e = ENVS[current];
  return {
    key: e.key, name: e.name, useMock: e.useMock, baseUrl: e.baseUrl,
    timeout: e.timeout, pageSize: e.pageSize, cacheTTL: e.cacheTTL,
  };
}
function getEnvList() {
  return Object.keys(ENVS).map((k) => ({
    key: k, name: ENVS[k].name, useMock: ENVS[k].useMock, baseUrl: ENVS[k].baseUrl,
  }));
}
function setEnv(key) {
  if (!ENVS[key]) return false;
  current = key;
  write(K_ENV, key);
  return true;
}
function setLanBase(url) {
  const v = String(url || '').trim().replace(/\/$/, '');
  if (!/^https?:\/\//.test(v)) return false;
  ENVS.lan.baseUrl = v;
  write(K_LAN, v);
  return true;
}
function getFault() { return fault; }
function setFault(value) { fault = value || ''; write(K_FAULT, fault); }

/** 把后端返回的 /assets/x.webp 补全为可访问地址；mock 模式返回空串，由页面渲染统一占位块。 */
function asset(path) {
  const c = getConfig();
  if (!path) return '';
  if (/^https?:\/\//.test(path)) return path;
  if (c.useMock) return '';
  return c.baseUrl + (path.charAt(0) === '/' ? path : '/' + path);
}

module.exports = {
  getConfig, getEnvList, setEnv, setLanBase, getFault, setFault, asset,
};
