/**
 * 图片加载失败统一降级。
 *
 * 真机上 `local`(127.0.0.1) / `lan`(HTTP) 的图片常被合法域名与 HTTPS 校验拦截，
 * 此时把 src 换到包内本地压缩图（/images/photos/），而不是留一个破图或空白。
 * 若本地图本身也失败，则置空让 WXML 的 wx:else 渲染 CSS 占位块，避免死循环。
 */
const photos = require('./photos.js');

module.exports = function onImgError(e) {
  const d = (e && e.currentTarget && e.currentTarget.dataset) || {};
  const item = d.item || {};
  const current = String(item.image || '');
  const next = current.indexOf('/images/photos/') === 0
    ? '' : photos.pick(item, d.idx);
  const patch = {};
  let key = 'detail.image';
  if (d.field) {
    const idx = Number(d.idx);
    key = d.field + '[' + (isNaN(idx) ? 0 : idx) + '].image';
  }
  patch[key] = next;
  this.setData(patch);
};
