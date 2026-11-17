/* PC 管理后台：数据看板、三类审核、活动发布、单据台账、账号与操作记录。 */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const E = UI.esc;
  const yuan = (v) => `<span class="price">¥${E(v)}</span>`;

  window.addEventListener('plum:unauthorized', (e) => {
    UI.toast(e.detail || '登录状态变了，重新登一下');
    Router.go('/login');
  });
  const cut = (v, n = 16) => E(String(v == null ? '' : v).slice(0, n));

  const PAGES = {
    '/dashboard': ['数据看板', '镇上今天怎么样'],
    '/merchants': ['商户审核', '谁来摆摊，先把把关'],
    '/sessions': ['场次审核', '哪天开园，后台点头才算数'],
    '/products': ['商品审核', '上柜之前看一眼'],
    '/festivals': ['活动发布', '赶集、节庆，都从这儿贴出去'],
    '/orders': ['订单管理', '一单一单，看得清楚'],
    '/reservations': ['预约管理', '摘梅子的、住店研学的，都在这儿'],
    '/logs': ['操作记录', '谁动过账本，留个痕'],
  };

  function syncNav(path) {
    const key = path.split('/')[1] || 'dashboard';
    document.querySelectorAll('.sidebar a').forEach((a) =>
      a.classList.toggle('on', a.dataset.nav === key));
    const meta = PAGES[path] || PAGES['/dashboard'];
    document.getElementById('pageTitle').textContent = meta[0];
    document.getElementById('pageSub').textContent = meta[1];
  }

  function syncAccount() {
    const u = Session.user();
    document.getElementById('whoami').textContent =
      u ? `${u.nickname} · ${u.role}` : '还没登录';
    document.getElementById('logoutBtn').style.display = u ? '' : 'none';
  }

  function login() {
    syncNav('/login');
    document.getElementById('pageTitle').textContent = '登录';
    document.getElementById('pageSub').textContent = '管理员从这儿进';
    app.innerHTML = `<div class="card" style="max-width:420px;margin:36px auto">
      <h3>后台登录</h3>
      <div class="field" style="margin-top:16px"><label>账号</label>
        <input class="input" id="u" value="admin" autocomplete="username" /></div>
      <div class="field"><label>口令</label>
        <input class="input" id="p" type="password" value="admin123" autocomplete="current-password" /></div>
      <button class="btn btn-primary btn-block" id="go">进后台</button></div>`;
    const go = async () => {
      try {
        const d = await API.post('/api/auth/login', {
          username: document.getElementById('u').value.trim(),
          password: document.getElementById('p').value, role: '管理员',
        });
        Session.set(d.sessionId, { nickname: d.nickname, role: d.role });
        syncAccount(); UI.toast('进来啦'); Router.go('/dashboard');
      } catch (e) { UI.toast(e.message); }
    };
    document.getElementById('go').onclick = go;
    document.getElementById('p').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  document.getElementById('logoutBtn').onclick = () => {
    UI.confirm('要退出后台吗？', () => {
      API.post('/api/auth/logout').catch(() => {});
      Session.clear(); syncAccount(); Router.go('/login');
    });
  };

  const guard = () => {
    const u = Session.user();
    if (Session.id() && u && u.role === '管理员') return true;
    if (Session.id()) Session.clear();
    Router.go('/login'); return false;
  };

  function table(headers, rowsHtml, emptyText) {
    if (!rowsHtml.length) return UI.empty(emptyText);
    return `<div class="table-wrap"><table class="table"><thead><tr>
      ${headers.map((h) => `<th>${E(h)}</th>`).join('')}</tr></thead>
      <tbody>${rowsHtml.join('')}</tbody></table></div>`;
  }

  /* ---------- 数据看板：统一 {labels, series} + 同一个 Charts 渲染器 ---------- */
  async function dashboard() {
    const d = await API.get('/api/admin/dashboard');
    const c = d.cards, ch = d.charts;
    const cards = [
      ['今日预约', c.today_reservation, '#/reservations'],
      ['待审商户', c.pending_merchant, '#/merchants'],
      ['待审场次', c.pending_session, '#/sessions'],
      ['待审商品', c.pending_product, '#/products'],
      ['累计销售额', '¥' + c.total_sales, '#/orders'],
      ['累计订单', c.total_orders, '#/orders'],
    ];
    app.innerHTML = `
      <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:18px">
        ${cards.map(([n, v, to]) => `<a class="stat" href="${to}" style="display:block">
          <div class="label">${E(n)}</div><div class="value">${E(v)}</div></a>`).join('')}
      </div>
      <div class="grid grid-2">
        <div class="chart-box"><h4>近 7 天：预约与销售</h4>
          <div class="small muted" style="margin-bottom:4px">预约数（个）／销售额（元）</div>
          <div id="trend"></div></div>
        <div class="chart-box"><h4>各门类卖得怎么样</h4>
          <div class="small muted" style="margin-bottom:4px">按已支付订单统计（元）</div>
          <div id="cats"></div></div>
        <div class="chart-box"><h4>卖得最好的几样</h4>
          <div class="small muted" style="margin-bottom:4px">累计销量（件）</div>
          <div id="tops"></div></div>
        <div class="chart-box"><h4>今天该办的事</h4>
          <div id="todos" style="padding-top:6px"></div></div>
      </div>`;
    Charts.draw(document.getElementById('trend'), ch.trend, 'line');
    Charts.draw(document.getElementById('cats'), ch.category_sales, 'bar');
    Charts.draw(document.getElementById('tops'), ch.top_products, 'bar');
    const todos = [
      ['商户等着审', c.pending_merchant, '#/merchants'],
      ['场次等着审', c.pending_session, '#/sessions'],
      ['商品等着审', c.pending_product, '#/products'],
    ];
    document.getElementById('todos').innerHTML = todos.map(([n, v, to]) => `
      <a href="${to}" style="display:flex;justify-content:space-between;align-items:center;
         padding:9px 2px;border-bottom:1px solid var(--line)">
        <span>${E(n)}</span><b>${v ? `<span class="badge badge-wait">${v} 条</span>` : '<span class="badge badge-ok">都办完了</span>'}</b>
      </a>`).join('');
  }

  /* ---------- 统一审核弹层：商户 / 场次 / 商品共用 ---------- */
  const AUDIT_CFG = {
    merchants: { path: '/api/admin/merchants', label: '商户', reload: () => merchants() },
    sessions: { path: '/api/admin/sessions', label: '场次', reload: () => sessions() },
    products: { path: '/api/admin/products', label: '商品', reload: () => products() },
  };

  function openAudit(kind, id, name, status, note) {
    const cfg = AUDIT_CFG[kind];
    if (status !== '待审核') { UI.toast('这条已经审过了'); return; }
    UI.sheet(`审一下：${name}`, `
      <div class="field"><label>审核意见（驳回时必填，100 字以内）</label>
        <textarea class="textarea" id="note" rows="3" maxlength="100"
          placeholder="比如：照片再补一张门头，或者把时段写清楚"></textarea></div>
      <div class="small muted">上次意见：${E(note || '无')}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn btn-primary" style="flex:1" data-act="通过">通过</button>
        <button class="btn" style="flex:1" data-act="驳回">驳回</button></div>`, (m) => {
      m.querySelectorAll('[data-act]').forEach((b) => b.onclick = async () => {
        const payload = { action: b.dataset.act, note: m.querySelector('#note').value.trim() };
        if (b.dataset.act === '驳回' && !payload.note) { UI.toast('驳回得写一句原因，商户好改'); return; }
        try {
          const r = await API.post(`${cfg.path}/${id}/audit`, payload);
          m.remove(); UI.toast(r.audit_status === '已通过' ? '通过了，三端立刻能看到' : '驳回了，原因已记下');
          cfg.reload();
        } catch (e) { UI.toast(e.message); }
      });
    });
  }

  function bindAudit(kind) {
    document.querySelectorAll('[data-audit]').forEach((b) => b.onclick = () =>
      openAudit(kind, Number(b.dataset.audit), b.dataset.name,
        b.dataset.status, b.dataset.note));
  }

  async function merchants() {
    const list = await API.get('/api/admin/merchants');
    app.innerHTML = `<div class="section-head"><h3>商户台账</h3>
        <span class="more">共 ${list.length} 家 · 待审 ${list.filter((x) => x.audit_status === '待审核').length} 家</span></div>
      ${table(['ID', '商户名', '联系人', '电话', '地址', '审核', '提交时间', '操作'],
      list.map((m) => `<tr><td>${m.id}</td><td><b>${E(m.name)}</b></td><td>${E(m.contact)}</td>
        <td>${E(m.phone)}</td><td>${cut(m.address, 22)}</td><td>${UI.badge(m.audit_status)}</td>
        <td class="small">${cut(m.created_at, 16)}</td>
        <td>${m.audit_status === '待审核'
          ? `<button class="btn btn-sm btn-primary" data-audit="${m.id}" data-name="${E(m.name)}"
               data-status="${E(m.audit_status)}" data-note="${E(m.audit_note)}">审一下</button>`
          : `<span class="small muted">${E(m.audit_note || '已办结')}</span>`}</td></tr>`),
      '还没有商户提交资料')}`;
    bindAudit('merchants');
  }

  async function sessions() {
    const list = await API.get('/api/admin/sessions');
    app.innerHTML = `<div class="section-head"><h3>采摘场次</h3>
        <span class="more">共 ${list.length} 场 · 待审 ${list.filter((x) => x.audit_status === '待审核').length} 场</span></div>
      ${table(['ID', '园子', '日期', '时段', '容量', '已约', '预约状态', '审核', '操作'],
      list.map((s) => `<tr><td>${s.id}</td><td>${E(s.orchard_name || '园子')}</td>
        <td>${E(s.session_date)}</td><td class="small">${E(s.slot)}</td>
        <td>${s.capacity}</td><td>${s.booked}</td><td>${UI.badge(s.status)}</td>
        <td>${UI.badge(s.audit_status)}</td>
        <td>${s.audit_status === '待审核'
          ? `<button class="btn btn-sm btn-primary" data-audit="${s.id}"
               data-name="${E((s.orchard_name || '园子') + ' ' + s.session_date)}"
               data-status="${E(s.audit_status)}" data-note="${E(s.audit_note)}">审一下</button>`
          : `<span class="small muted">${E(s.audit_note || '已办结')}</span>`}</td></tr>`),
      '还没有排场次')}`;
    bindAudit('sessions');
  }

  async function products() {
    const list = await API.get('/api/admin/products');
    app.innerHTML = `<div class="section-head"><h3>农特产品</h3>
        <span class="more">共 ${list.length} 件 · 待审 ${list.filter((x) => x.audit_status === '待审核').length} 件</span></div>
      ${table(['', '商品', '门类', '价格', '库存', '已售', '上架', '审核', '操作'],
      list.map((p) => `<tr>
        <td>${UI.img(p.image, 'img-1-1', 'style="width:44px;height:44px"')}</td>
        <td><b>${E(p.name)}</b><div class="small muted ellipsis" style="max-width:220px">${E(p.subtitle)}</div></td>
        <td>${E(p.category_name)}</td><td>${yuan(p.price)}</td><td>${p.stock}</td><td>${p.sales}</td>
        <td>${UI.badge(p.shelf_status)}</td><td>${UI.badge(p.audit_status)}</td>
        <td>${p.audit_status === '待审核'
          ? `<button class="btn btn-sm btn-primary" data-audit="${p.id}" data-name="${E(p.name)}"
               data-status="${E(p.audit_status)}" data-note="${E(p.audit_note)}">审一下</button>`
          : `<span class="small muted">${E(p.audit_note || '已办结')}</span>`}</td></tr>`),
      '还没有商品')}`;
    bindAudit('products');
  }

  /* ---------- 活动发布：发布后游客端首页立刻可见 ---------- */
  async function festivals() {
    const list = await API.get('/api/admin/festivals');
    app.innerHTML = `<div style="display:flex;justify-content:flex-end;margin-bottom:14px">
        <button class="btn btn-primary" id="newBtn">＋ 发个活动</button></div>
      <div class="grid grid-3">
        ${list.map((f) => `<div class="card">
          ${UI.img(f.image, 'img-16-9')}
          <div style="margin-top:8px;display:flex;justify-content:space-between;align-items:center">
            <b>${E(f.title)}</b>${UI.badge(f.status)}</div>
          <div class="small muted">${E(f.festival_date)} · ${E(f.place)}</div>
          <p class="small muted" style="margin-top:6px">${E(f.intro)}</p>
          <button class="btn btn-sm btn-block" data-toggle="${f.id}" data-status="${E(f.status)}">
            ${f.status === '展示中' ? '先撤下来' : '重新贴出去'}</button></div>`).join('')}
      </div>`;
    document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
      const status = b.dataset.status === '展示中' ? '已下线' : '展示中';
      try {
        await API.put('/api/admin/festivals/' + b.dataset.toggle, { status });
        UI.toast(status === '展示中' ? '贴出去了' : '先撤下来了'); festivals();
      } catch (e) { UI.toast(e.message); }
    });
    document.getElementById('newBtn').onclick = () => {
      const images = ['/assets/banner_01.webp', '/assets/banner_02.webp',
        '/assets/banner_03.webp', '/assets/banner_04.webp'];
      UI.sheet('发个活动', `
        <div class="field"><label>活动名</label><input class="input" id="title" maxlength="40"
          value="青梅采摘节" /></div>
        <div class="form-row">
          <div class="field"><label>时间</label><input class="input" id="when" value="6月上旬 09:00-17:00" /></div>
          <div class="field"><label>地点</label><input class="input" id="place" value="䢺江镇青梅广场" /></div></div>
        <div class="field"><label>说两句</label><textarea class="textarea" id="intro" rows="3"
          maxlength="200">梅子熟了，来园子里摘一篮，晚上还有坝坝宴。</textarea></div>
        <div class="field"><label>配图</label><select class="select" id="image">
          ${images.map((i, n) => `<option value="${i}">统一素材 ${n + 1}</option>`).join('')}</select></div>
        <button class="btn btn-primary btn-block" id="go">贴到游客端</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try {
            const r = await API.post('/api/admin/festivals', {
              title: m.querySelector('#title').value,
              festival_date: m.querySelector('#when').value,
              place: m.querySelector('#place').value,
              intro: m.querySelector('#intro').value,
              image: m.querySelector('#image').value,
            });
            m.remove(); UI.toast(r.tip); festivals();
          } catch (e) { UI.toast(e.message); }
        };
      });
    };
  }

  /* ---------- 单据台账 ---------- */
  async function orders(status) {
    const d = await API.get('/api/admin/orders?pageSize=50' + (status ? '&status=' + encodeURIComponent(status) : ''));
    const opts = ['待支付', '已支付', '已发货', '已完成', '已取消'];
    app.innerHTML = `<div style="display:flex;gap:10px;align-items:center;margin-bottom:14px">
        <span class="small muted">共 ${d.total} 笔</span>
        <select class="select" id="filter" style="width:180px">
          <option value="">全部状态</option>
          ${opts.map((s) => `<option value="${E(s)}" ${s === status ? 'selected' : ''}>${E(s)}</option>`).join('')}
        </select></div>
      ${table(['单号', '收件人', '电话', '收货地址', '金额', '状态', '下单时间'],
      d.records.map((o) => `<tr><td><b>${E(o.order_no)}</b></td><td>${E(o.receiver)}</td>
        <td>${E(o.phone)}</td><td>${cut(o.address, 24)}</td><td>${yuan(o.amount)}</td>
        <td>${UI.badge(o.status)}</td><td class="small">${cut(o.created_at, 16)}</td></tr>`),
      '这个状态下还没有订单')}`;
    document.getElementById('filter').onchange = (e) => orders(e.target.value);
  }

  async function reservations() {
    const d = await API.get('/api/admin/reservations?pageSize=50');
    app.innerHTML = `<div class="small muted" style="margin-bottom:14px">共 ${d.total} 条采摘预约，
      核销码由商户工作台统一使用，状态三端一致。</div>
      ${table(['预约码', '园子', '游玩日期', '时段', '人数', '联系人', '金额', '状态', '核销码'],
      d.records.map((r) => `<tr><td><b>${E(r.code)}</b></td><td>${E(r.orchard_name || '园子')}</td>
        <td>${E(r.visit_date)}</td><td class="small">${E(r.slot)}</td><td>${r.people}</td>
        <td>${E(r.contact)}<div class="small muted">${E(r.phone)}</div></td>
        <td>${yuan(r.amount)}</td><td>${UI.badge(r.status)}</td>
        <td class="small">${E(r.checkin_code)}</td></tr>`),
      '还没有预约')}`;
  }

  /* ---------- 操作记录 + 账号一览 ---------- */
  async function logs() {
    const list = await API.get('/api/admin/logs');
    const users = await API.get('/api/admin/users?pageSize=50');
    app.innerHTML = `<div class="section-head"><h3>最近 50 条操作</h3></div>
      ${table(['时间', '谁', '动作', '对象', '备注'],
      list.map((l) => `<tr><td class="small">${cut(l.created_at, 16)}</td>
        <td>${E(l.nickname || '系统')}</td><td>${UI.badge(l.action)}</td>
        <td>${cut(l.target, 26)}</td><td class="small muted">${cut(l.detail, 40)}</td></tr>`),
      '还没有操作记录')}
      <div class="section-head"><h3>账号一览</h3><span class="more">共 ${users.total} 个</span></div>
      ${table(['ID', '账号', '昵称', '角色', '电话', '状态', '注册时间'],
      users.records.map((u) => `<tr><td>${u.id}</td><td>${E(u.username)}</td><td>${E(u.nickname)}</td>
        <td>${E(u.role)}</td><td>${E(u.phone)}</td><td>${UI.badge(u.status)}</td>
        <td class="small">${cut(u.created_at, 16)}</td></tr>`), '没有账号')}`;
  }

  const routes = { '/dashboard': dashboard, '/home': dashboard, '/merchants': merchants,
    '/sessions': sessions, '/products': products, '/festivals': festivals,
    '/orders': () => orders(''), '/reservations': reservations, '/logs': logs };

  Router.on(async (path) => {
    syncAccount(); syncNav(path);
    if (path === '/login') { login(); return; }
    if (!guard()) return;
    const handler = routes[path] || dashboard;
    app.innerHTML = UI.loading();
    try { await handler(); } catch (e) {
      if (e.code === 401 || e.code === 403) { Session.clear(); Router.go('/login'); return; }
      app.innerHTML = `<div class="card"><b>这页没打开</b><p class="small muted">${E(e.message)}</p>
        <a class="btn btn-sm" href="#/dashboard">回看板</a></div>`;
    }
    window.scrollTo(0, 0);
  });
})();
