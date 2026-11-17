/**
 * 带过期时间的本地缓存。所有缓存统一加前缀，方便「清空缓存」与容量统计。
 * 底层只用 wx.getStorageSync / wx.setStorageSync，符合小程序原生规范。
 */
const PREFIX = 'plum_cache_';

function wrap(key) { return PREFIX + key; }

function set(key, value, ttlSeconds) {
  const ttl = ttlSeconds === undefined ? 300 : ttlSeconds;
  try {
    wx.setStorageSync(wrap(key), {
      v: value,
      e: ttl > 0 ? Date.now() + ttl * 1000 : 0,
    });
    return true;
  } catch (e) { return false; }
}

function get(key) {
  try {
    const raw = wx.getStorageSync(wrap(key));
    if (!raw || typeof raw !== 'object' || !Object.prototype.hasOwnProperty.call(raw, 'v')) return null;
    if (raw.e && raw.e < Date.now()) {
      wx.removeStorageSync(wrap(key));
      return null;
    }
    return raw.v;
  } catch (e) { return null; }
}

function remove(key) {
  try { wx.removeStorageSync(wrap(key)); } catch (e) { /* noop */ }
}

/** 清空业务缓存；keep 里的 key 保留（如收藏），避免清缓存把用户内容一起删掉。 */
function clearExcept(keep) {
  const keepSet = {};
  (keep || []).forEach((k) => { keepSet[wrap(k)] = true; });
  try {
    const info = wx.getStorageInfoSync();
    (info.keys || []).forEach((k) => {
      if (k.indexOf(PREFIX) === 0 && !keepSet[k]) wx.removeStorageSync(k);
    });
  } catch (e) { /* noop */ }
}

function clear() { return clearExcept([]); }

function stats() {
  try {
    const info = wx.getStorageInfoSync();
    const keys = (info.keys || []).filter((k) => k.indexOf(PREFIX) === 0);
    return { count: keys.length, sizeKB: info.currentSize || 0, limitKB: info.limitSize || 10240 };
  } catch (e) { return { count: 0, sizeKB: 0, limitKB: 10240 }; }
}

module.exports = { set, get, remove, clear, clearExcept, stats, PREFIX };
