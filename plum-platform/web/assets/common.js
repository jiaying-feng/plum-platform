/* 三端共用：请求封装、会话、通用组件、统一图表渲染器。零第三方库。 */
(function (global) {
  'use strict';

  const BASE = global.PLUM_BASE || '';
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200">' +
    '<rect width="320" height="200" fill="#eaf4ea"/>' +
    '<circle cx="160" cy="88" r="30" fill="#bcd9bd"/>' +
    '<text x="160" y="140" text-anchor="middle" fill="#3f8f52" font-size="15">青梅</text></svg>');

  class ApiError extends Error {
    constructor(payload) { super(payload.msg || '出了点小状况'); this.code = payload.code; }
  }

  /* ---------- 按端隔离的会话 ----------
     同一个浏览器里消费者站、商户站、PC 后台与两个 H5 各自登录，互不顶号。
     命名空间优先取 window.PLUM_NS，否则按访问路径自动推断，现有页面无需改动。 */
  const NS = (function () {
    if (global.PLUM_NS) return String(global.PLUM_NS);
    const p = (global.location && global.location.pathname) || '';
    if (p.indexOf('/consumer') === 0) return 'consumer';
    if (p.indexOf('/biz') === 0) return 'biz';
    if (p.indexOf('/admin') === 0) return 'admin';
    if (p.indexOf('/merchant') === 0) return 'merchant';
    if (p.indexOf('/visitor') === 0) return 'visitor';
    return 'portal';
  })();
  const PREFIX = 'plum_' + NS + '_';
  const K_SID = PREFIX + 'sid';
  const K_USER = PREFIX + 'user';

  const Session = {
    ns: NS,
    keys: { sid: K_SID, user: K_USER },
    id: () => localStorage.getItem(K_SID) || '',
    user() {
      try { return JSON.parse(localStorage.getItem(K_USER) || 'null'); }
      catch (e) { return null; }
    },
    set(sid, user) {
      localStorage.setItem(K_SID, sid);
      localStorage.setItem(K_USER, JSON.stringify(user));
    },
    clear() { localStorage.removeItem(K_SID); localStorage.removeItem(K_USER); },
  };

  /** 门户用：只读地列出其它端已登录的身份，不改动任何会话 */
  Session.all = function () {
    const out = [];
    ['consumer', 'biz', 'admin', 'visitor', 'merchant'].forEach((ns) => {
      try {
        const u = JSON.parse(localStorage.getItem('plum_' + ns + '_user') || 'null');
        const sid = localStorage.getItem('plum_' + ns + '_sid');
        if (u && sid) out.push({ ns, nickname: u.nickname, role: u.role });
      } catch (e) { /* 忽略坏数据 */ }
    });
    return out;
  };

  async function request(method, path, payload) {
    const headers = { 'Content-Type': 'application/json' };
    if (Session.id()) headers['X-Session-Id'] = Session.id();
    let res;
    try {
      res = await fetch(BASE + path, {
        method, headers,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch (e) {
      UI.toast('连不上服务，看看是不是还没启动');
      throw new ApiError({ code: 0, msg: '网络不通' });
    }
    let json;
    try { json = await res.json(); } catch (e) { throw new ApiError({ code: res.status, msg: '返回格式不对' }); }
    if (json.code !== 200) {
      if (json.code === 401 || json.code === 403) {
        Session.clear();
        global.dispatchEvent(new CustomEvent('plum:unauthorized', { detail: json.msg }));
      }
      throw new ApiError(json);
    }
    return json.data;
  }

  const API = {
    get: (p) => request('GET', p),
    post: (p, b) => request('POST', p, b === undefined ? {} : b),
    put: (p, b) => request('PUT', p, b === undefined ? {} : b),
    del: (p) => request('DELETE', p),
  };

  const UI = {
    PLACEHOLDER, esc,
    img(src, cls = 'img-4-3', extra = '') {
      return `<img class="img ${cls}" src="${esc(src || PLACEHOLDER)}" ${extra}
        onerror="this.onerror=null;this.src=UI.PLACEHOLDER" alt="青梅">`;
    },
    toast(msg) {
      document.querySelectorAll('.toast').forEach((n) => n.remove());
      const el = document.createElement('div');
      el.className = 'toast'; el.textContent = msg;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), 2600);
    },
    badge(text) {
      const t = String(text || '');
      let cls = 'badge';
      if (/待审核|待支付|待核销|待办/.test(t)) cls += ' badge-wait';
      else if (/已通过|已支付|已核销|已完成|已发货|启用|上架|展示中|报名中|可预约/.test(t)) cls += ' badge-ok';
      else if (/已驳回|已取消|已退款|已过期|下架|停用/.test(t)) cls += ' badge-danger';
      else cls += ' badge-off';
      return `<span class="${cls}">${esc(t)}</span>`;
    },
    empty(text) { return `<div class="empty">${esc(text || '这里还空着，过会儿再来看看')}</div>`; },
    loading() { return '<div class="loading">正在把东西端上来…</div>'; },
    money(v) { return `¥${esc(v)}`; },
    sheet(title, html, onMount) {
      document.querySelectorAll('.mask').forEach((n) => n.remove());
      const mask = document.createElement('div');
      mask.className = 'mask';
      mask.innerHTML = `<div class="sheet"><h3>${esc(title)}</h3>${html}
        <div style="margin-top:14px"><button class="btn btn-block" data-close>关掉</button></div></div>`;
      mask.addEventListener('click', (e) => {
        if (e.target === mask || e.target.hasAttribute('data-close')) mask.remove();
      });
      document.body.appendChild(mask);
      if (onMount) onMount(mask);
      return mask;
    },
    confirm(text, onYes) {
      const mask = UI.sheet('再确认一下', `<p class="small muted">${esc(text)}</p>
        <button class="btn btn-primary btn-block" data-yes>就这么办</button>`, (m) => {
        m.querySelector('[data-yes]').onclick = () => { m.remove(); onYes(); };
      });
      return mask;
    },
  };

  /* ---------- 统一图表渲染器 ----------
     所有图表共用 {labels:[], series:[{name,data}]} 结构，
     统一画布 640×220、统一网格/圆角/配色/字号，保证后台与工作台长得一模一样。 */
  const PALETTE = ['#3f8f52', '#c8912f', '#4a7fa5', '#b2605c'];
  const Charts = {
    draw(container, chart, type = 'bar') {
      if (!container) return;
      const labels = (chart && chart.labels) || [];
      const series = (chart && chart.series) || [];
      if (!labels.length || !series.length) { container.innerHTML = UI.empty('这组数据还没攒够'); return; }
      const W = 640, H = 220, L = 46, R = 14, T = 20, B = 36;
      const iw = W - L - R, ih = H - T - B;
      const all = series.flatMap((s) => s.data.map(Number));
      const rawMax = Math.max(...all, 1);
      const step = Math.pow(10, Math.floor(Math.log10(rawMax)));
      const max = Math.ceil(rawMax / step) * step || 1;
      const x = (i) => L + (iw / labels.length) * (i + 0.5);
      const y = (v) => T + ih - (Number(v) / max) * ih;
      let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="数据图表">`;
      for (let g = 0; g <= 4; g++) {
        const gy = T + (ih / 4) * g;
        svg += `<line x1="${L}" y1="${gy}" x2="${W - R}" y2="${gy}" stroke="#e8ece6" stroke-width="1"/>`;
        svg += `<text x="${L - 8}" y="${gy + 4}" text-anchor="end" font-size="10" fill="#79857c">${(max * (1 - g / 4)).toFixed(0)}</text>`;
      }
      if (type === 'line') {
        series.forEach((s, si) => {
          const pts = s.data.map((v, i) => `${x(i)},${y(v)}`).join(' ');
          svg += `<polyline points="${pts}" fill="none" stroke="${PALETTE[si % 4]}" stroke-width="2.5"
            stroke-linejoin="round" stroke-linecap="round"/>`;
          s.data.forEach((v, i) => {
            svg += `<circle cx="${x(i)}" cy="${y(v)}" r="3.5" fill="#fff"
              stroke="${PALETTE[si % 4]}" stroke-width="2"/>`;
          });
        });
      } else {
        const groupW = iw / labels.length, bw = Math.min(26, groupW / (series.length + 1));
        series.forEach((s, si) => {
          s.data.forEach((v, i) => {
            const bx = x(i) - (series.length * bw) / 2 + si * bw + 1;
            const by = y(v), bh = Math.max(1, T + ih - by);
            svg += `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${(bw - 3).toFixed(1)}"
              height="${bh.toFixed(1)}" rx="4" fill="${PALETTE[si % 4]}"/>`;
            if (series.length === 1 && Number(v) > 0) {
              svg += `<text x="${(bx + bw / 2 - 1).toFixed(1)}" y="${(by - 5).toFixed(1)}"
                text-anchor="middle" font-size="10" fill="#5b6b5e">${Number(v)}</text>`;
            }
          });
        });
      }
      const skip = Math.ceil(labels.length / 8);
      labels.forEach((lb, i) => {
        if (i % skip === 0 || i === labels.length - 1) {
          svg += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" font-size="10"
            fill="#79857c">${esc(String(lb).slice(0, 8))}</text>`;
        }
      });
      svg += `<line x1="${L}" y1="${T + ih}" x2="${W - R}" y2="${T + ih}" stroke="#cfd9cd"/>`;
      svg += '</svg>';
      const legend = `<div class="chart-legend">${series.map((s, i) =>
        `<span><i style="background:${PALETTE[i % 4]}"></i>${esc(s.name)}</span>`).join('')}</div>`;
      container.innerHTML = svg + legend;
    },
    bar(el, chart) { Charts.draw(el, chart, 'bar'); },
    line(el, chart) { Charts.draw(el, chart, 'line'); },
  };

  const Router = {
    go(hash) { location.hash = hash; },
    on(handler) {
      const run = () => handler((location.hash || '#/home').slice(1) || '/home');
      global.addEventListener('hashchange', run);
      run();
    },
  };

  global.API = API; global.UI = UI; global.Session = Session;
  global.Charts = Charts; global.Router = Router; global.ApiError = ApiError;
  global.esc = esc;

  /* 直接双击 HTML 文件（file://）时 /web/... 与 /api/... 全部 404，
     表现为「页面没数据、地图不显示」。这里给出明确原因，避免误判地图组件坏了。 */
  if (global.location && global.location.protocol === 'file:') {
    global.addEventListener('DOMContentLoaded', () => {
      const bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:9999;' +
        'padding:10px 14px;background:#8a4b2a;color:#fff;font-size:13px;line-height:1.6;';
      bar.textContent = '当前是用 file:// 直接打开的 HTML，静态资源和接口都取不到，地图与图片不会显示。' +
        ' 请先双击 start.bat，再访问 http://127.0.0.1:8080/ 。';
      document.body.appendChild(bar);
    });
  }
})(window);
