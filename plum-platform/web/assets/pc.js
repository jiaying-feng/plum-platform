/* PC 桌面组件层：面包屑、统计卡、数据表格、分页、表单、居中弹层、右侧抽屉、角色守卫。
   依赖 common.js 的 UI / Session / Router / API，零第三方库。 */
(function (global) {
  'use strict';

  const E = UI.esc;

  function qs(params) {
    const p = Object.keys(params || {}).filter((k) =>
      params[k] !== undefined && params[k] !== null && params[k] !== '');
    if (!p.length) return '';
    return '?' + p.map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
  }

  function requestId() {
    return 'pc-' + Date.now() + '-' + Math.floor(Math.random() * 100000);
  }

  function crumb(items) {
    const parts = items.map((it, i) => {
      const last = i === items.length - 1;
      const body = it.href && !last
        ? `<a href="${E(it.href)}">${E(it.text)}</a>` : `<b>${E(it.text)}</b>`;
      return (i ? '<span>/</span>' : '') + body;
    });
    return `<div class="pc-crumb">${parts.join('')}</div>`;
  }

  function loading(text) {
    return `<div class="loading">${E(text || '正在把东西端上来…')}</div>`;
  }

  function empty(text) {
    return `<div class="empty">${E(text || '这里还空着，过会儿再来看看')}</div>`;
  }

  function error(msg, retryable) {
    return `<div class="pc-error"><div class="msg">${E(msg || '这页没打开')}</div>
      ${retryable === false ? '' : '<button class="btn btn-primary btn-sm" data-retry>再试一次</button>'}</div>`;
  }

  function bindRetry(root, fn) {
    const btn = root && root.querySelector('[data-retry]');
    if (btn) btn.onclick = fn;
  }

  function stat(items) {
    return `<div class="pc-stat-grid">${(items || []).map((s) => `
      <div class="pc-stat"><div class="label">${E(s.label)}</div>
        <div class="value">${E(s.value)}</div>
        ${s.foot ? `<div class="foot">${E(s.foot)}</div>` : ''}</div>`).join('')}</div>`;
  }

  /** cols: [{title, key, width, align, render(row,i), sortable, sortKey}] */
  function table(cols, rows, opts) {
    const o = opts || {};
    const head = cols.map((c) => {
      const th = c.sortable
        ? `<a href="javascript:void(0)" data-sort="${E(c.sortKey || c.key || '')}">${E(c.title)}</a>`
        : E(c.title);
      return `<th class="${c.sortable ? 'sortable' : ''} ${c.align === 'right' ? 'num' : ''}"
        ${c.width ? `style="width:${E(c.width)}"` : ''}>${th}</th>`;
    }).join('');
    const body = (rows && rows.length)
      ? rows.map((r, i) => `<tr${o.key ? ` data-row="${E(r[o.key])}"` : ''}>` +
        cols.map((c) => {
          const html = c.render ? c.render(r, i) : E(r[c.key] == null ? '' : r[c.key]);
          return `<td class="${c.align === 'right' ? 'num' : ''}">${html}</td>`;
        }).join('') + '</tr>').join('')
      : `<tr><td colspan="${cols.length}">${empty(o.empty)}</td></tr>`;
    return `<div class="table-wrap"><table class="table data-table">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  function pager(page, size, total) {
    const pages = Math.max(1, Math.ceil((Number(total) || 0) / (Number(size) || 20)));
    const cur = Math.min(Math.max(1, Number(page) || 1), pages);
    const nums = [];
    for (let i = 1; i <= pages; i++) {
      if (i === 1 || i === pages || Math.abs(i - cur) <= 2) nums.push(i);
      else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    const btns = nums.map((n) => n === '…'
      ? '<span class="muted">…</span>'
      : `<button class="btn btn-sm ${n === cur ? 'on' : ''}" data-page="${n}">${n}</button>`).join('');
    return `<div class="pc-pager">
      <span class="total">共 ${E(total)} 条 · 第 ${cur}/${pages} 页</span>
      <button class="btn btn-sm" data-page="${Math.max(1, cur - 1)}" ${cur <= 1 ? 'disabled' : ''}>上一页</button>
      ${btns}
      <button class="btn btn-sm" data-page="${Math.min(pages, cur + 1)}" ${cur >= pages ? 'disabled' : ''}>下一页</button>
    </div>`;
  }

  function bindPager(root, onGo) {
    if (!root) return;
    root.querySelectorAll('[data-page]').forEach((b) => {
      b.onclick = () => { const n = Number(b.dataset.page); if (n) onGo(n); };
    });
  }

  /** 数组型接口在客户端分页，与后端 C.paginate 的返回结构保持一致 */
  function clientPage(list, page, size) {
    const all = list || [];
    const p = Math.max(1, Number(page) || 1);
    const s = Math.max(1, Number(size) || 12);
    return { records: all.slice((p - 1) * s, p * s), total: all.length, current: p, size: s };
  }

  /** fields: [{name,label,type,required,options,value,placeholder,min,max,step,hint}] */
  function form(fields, values) {
    const v = values || {};
    return `<div class="pc-form two">${fields.map((f) => {
      const val = v[f.name] !== undefined ? v[f.name] : (f.value !== undefined ? f.value : '');
      const id = 'f_' + f.name;
      let input;
      if (f.type === 'select') {
        input = `<select class="select" id="${E(id)}" name="${E(f.name)}">${(f.options || []).map((o) =>
          `<option value="${E(o.value)}" ${String(o.value) === String(val) ? 'selected' : ''}>${E(o.text)}</option>`).join('')}</select>`;
      } else if (f.type === 'textarea') {
        input = `<textarea class="textarea" id="${E(id)}" name="${E(f.name)}" rows="${f.rows || 3}"
          placeholder="${E(f.placeholder || '')}">${E(val)}</textarea>`;
      } else {
        input = `<input class="input" id="${E(id)}" name="${E(f.name)}" type="${E(f.type || 'text')}"
          value="${E(val)}" placeholder="${E(f.placeholder || '')}"
          ${f.min !== undefined ? `min="${E(f.min)}"` : ''} ${f.max !== undefined ? `max="${E(f.max)}"` : ''}
          ${f.step !== undefined ? `step="${E(f.step)}"` : ''} />`;
      }
      return `<div class="pc-field">
        <label for="${E(id)}">${E(f.label)}${f.required ? '<em>*</em>' : ''}</label>
        ${input}
        ${f.hint ? `<div class="pc-form-note">${E(f.hint)}</div>` : ''}
        <div class="pc-err" data-err="${E(f.name)}"></div></div>`;
    }).join('')}</div>`;
  }

  function readForm(root, fields) {
    const out = {};
    fields.forEach((f) => {
      const el = root.querySelector('[name="' + f.name + '"]');
      if (!el) return;
      let val = el.value;
      if (f.type === 'number') val = Number(val);
      out[f.name] = typeof val === 'string' ? val.trim() : val;
    });
    return out;
  }

  function validate(root, fields) {
    let ok = true;
    fields.forEach((f) => {
      const box = root.querySelector('[data-err="' + f.name + '"]');
      const input = root.querySelector('[name="' + f.name + '"]');
      if (box) box.textContent = '';
      if (input) input.classList.remove('req');
      if (!f.required) return;
      const val = input ? String(input.value || '').trim() : '';
      if (!val) {
        if (box) box.textContent = (f.label || f.name) + '不能空着';
        if (input) input.classList.add('req');
        ok = false;
      }
    });
    return ok;
  }

  function onEnter(root, fn) {
    if (!root) return;
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault(); fn();
      }
    });
  }

  function modal(title, html, onMount) {
    document.querySelectorAll('.pc-modal').forEach((n) => n.remove());
    const el = document.createElement('div');
    el.className = 'mask pc-modal';
    el.innerHTML = `<div class="pc-dialog" role="dialog" aria-modal="true" aria-label="${E(title)}">
      <div class="pc-dialog-head"><b>${E(title)}</b>
        <button type="button" class="pc-x" data-close aria-label="关闭">×</button></div>
      <div class="pc-dialog-body">${html}</div></div>`;
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    el.addEventListener('click', (e) => {
      if (e.target === el || (e.target.closest && e.target.closest('[data-close]'))) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    el.close = close;
    if (onMount) onMount(el, close);
    const first = el.querySelector('input, select, textarea');
    if (first) setTimeout(() => first.focus(), 30);
    return el;
  }

  function confirm(text, onYes, okText) {
    return modal('再确认一下', `<p class="small" style="line-height:1.9">${E(text)}</p>
      <div class="pc-form-actions">
        <button class="btn" data-close>算了</button>
        <button class="btn btn-primary" data-yes>${E(okText || '就这么办')}</button></div>`,
      (el, close) => {
        el.querySelector('[data-yes]').onclick = () => { close(); onYes(); };
      });
  }

  function drawer(title, html, onMount) {
    document.querySelectorAll('.pc-drawer-mask').forEach((n) => n.remove());
    const el = document.createElement('div');
    el.className = 'pc-drawer-mask';
    el.innerHTML = `<div class="pc-drawer" role="dialog" aria-label="${E(title)}">
      <div class="pc-drawer-head"><b>${E(title)}</b>
        <button type="button" class="pc-x" data-close aria-label="关闭">×</button></div>
      <div class="pc-drawer-body">${html}</div></div>`;
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    el.addEventListener('click', (e) => {
      if (e.target === el || (e.target.closest && e.target.closest('[data-close]'))) close();
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(el);
    el.close = close;
    if (onMount) onMount(el, close);
    return el;
  }

  /** 前端路由守卫：后端 require_login 仍是最终防线 */
  function guard(roles, loginPath) {
    const u = Session.user();
    if (Session.id() && u && (!roles || roles.indexOf(u.role) >= 0)) return true;
    if (Session.id()) Session.clear();
    UI.toast('请先用对应身份登录');
    Router.go(loginPath || '/login');
    return false;
  }

  function syncGuardEvent(loginPath) {
    window.addEventListener('plum:unauthorized', (e) => {
      UI.toast(e.detail || '登录状态变了，重新登一下');
      Router.go(loginPath || '/login');
    });
  }

  /** 卡片：消费者站列表复用，image 走 UI.img 的统一占位 */
  function productCard(item, opts) {
    const o = opts || {};
    const href = o.href || ('#/product/' + item.id);
    const title = item.name || item.title || '未命名';
    return `<article class="pc-card">
      <a href="${E(href)}">${UI.img(item.image, 'img-4-3')}</a>
      <div class="pc-card-body">
        <h3 class="ellipsis"><a href="${E(href)}">${E(title)}</a></h3>
        <div class="small muted ellipsis">${E(o.desc || item.subtitle || item.address || '')}</div>
        <div class="price" style="font-size:18px;margin-top:8px">${E(o.priceText || ('¥' + item.price))}</div>
      </div>
      <div class="pc-card-foot">
        <span class="tag">${E(o.tag || '青梅')}</span>
        ${o.action || ''}
      </div></article>`;
  }

  const PC = {
    esc: E, qs, requestId, crumb, loading, empty, error, bindRetry, stat,
    table, pager, bindPager, clientPage, form, readForm, validate, onEnter,
    modal, confirm, drawer, guard, syncGuardEvent, productCard,
  };
  global.PC = PC;
})(window);
