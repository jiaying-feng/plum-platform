/* 农户 / 民宿商户 H5 工作台：场次、房间、商品、订单、统一核销。 */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const E = UI.esc;
  const yuan = (v) => `<span class="price">¥${E(v)}</span>`;

  window.addEventListener('plum:unauthorized', (e) => {
    UI.toast(e.detail || '登录状态变了，重新登一下');
    Router.go('/login');
  });

  function syncAccount() {
    const u = Session.user();
    const btn = document.getElementById('accountBtn');
    btn.textContent = u ? u.nickname : '登录';
    btn.onclick = () => {
      if (!u) return Router.go('/login');
      UI.confirm('要退出吗？', () => { API.post('/api/auth/logout').catch(() => {});
        Session.clear(); location.reload(); });
    };
  }
  function syncTab(path) {
    const key = path.split('/')[1] || 'home';
    document.querySelectorAll('.tabbar a').forEach((a) =>
      a.classList.toggle('on', a.dataset.tab === key));
  }
  const guard = () => {
    const u = Session.user();
    if (Session.id() && u && (u.role === '商户' || u.role === '管理员')) return true;
    if (Session.id()) Session.clear();
    UI.toast('先用商户账号登录'); Router.go('/login'); return false;
  };

  function login() {
    document.getElementById('topSub').textContent = '登录一下，把摊子摆起来';
    app.innerHTML = `<div class="card" style="margin-top:20px"><h3>商户登录</h3>
      <div class="field" style="margin-top:14px"><label>账号</label><input class="input" id="u" value="farmer01" /></div>
      <div class="field"><label>口令</label><input class="input" id="p" type="password" value="merchant123" /></div>
      <button class="btn btn-primary btn-block" id="go">进工作台</button></div>`;
    document.getElementById('go').onclick = async () => {
      try {
        const d = await API.post('/api/auth/login', { username: document.getElementById('u').value,
          password: document.getElementById('p').value, role: '商户' });
        Session.set(d.sessionId, { nickname: d.nickname, role: d.role });
        syncAccount(); UI.toast('进来啦'); Router.go('/home');
      } catch (e) { UI.toast(e.message); }
    };
  }

  async function home() {
    document.getElementById('topSub').textContent = '排场次、调房价、发货、核销';
    const d = await API.get('/api/merchant/overview');
    const todos = await API.get('/api/merchant/bookings');
    const entries = [
      ['/sessions', '场次'], ['/rooms', '房间'], ['/products', '商品'],
      ['/orders', '订单'], ['/checkin', '核销'], ['/products', '上架'],
      ['/sessions', '研学'], ['/rooms', '园子'],
    ];
    app.innerHTML = `<div class="stat-grid">
      ${[['今日订单', d.today_orders], ['待核销', d.pending_checkin],
         ['在售商品', d.on_sale], ['今日预约', d.today_bookings]].map(([n, v]) =>
        `<div class="stat"><div class="label">${n}</div><div class="value">${v}</div></div>`).join('')}</div>
      <div class="section-head"><h3>手上这些活</h3></div>
      <div class="grid grid-4">${entries.map(([p, n]) => `
        <a class="card card-flat" href="#${p}" style="text-align:center;padding:18px 4px">
          <div class="small">${n}</div></a>`).join('')}</div>
      <div class="section-head"><h3>等着核销的</h3>
        <a class="more" href="#/checkin">去核销 ›</a></div>
      ${todos.length ? todos.slice(0, 5).map((t) => `<div class="card" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between"><b class="small">${E(t.code)}</b>
          ${UI.badge(t.type_label)}</div>
        <div class="small muted">${E(t.created_at.slice(0, 16))} · 码 ${E(t.checkin_code)}</div></div>`).join('')
        : UI.empty('这会儿没有等着核销的，歇口气')}`;
  }

  async function sessions() {
    document.getElementById('topSub').textContent = '把场次排好，游客才约得上';
    const [list, orchards] = await Promise.all([
      API.get('/api/merchant/sessions'), API.get('/api/orchards?pageSize=50')]);
    app.innerHTML = `<button class="btn btn-primary btn-block" id="newBtn">＋ 排一场</button>
      <div class="section-head"><h3>已排场次</h3><span class="more">共 ${list.length} 场</span></div>
      <div id="list"></div>`;
    const draw = (items) => {
      document.getElementById('list').innerHTML = items.length ? items.slice(0, 30).map((s) => `
        <div class="card" style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between"><b class="small">${E(s.orchard_name || '园子')}</b>
            ${UI.badge(s.audit_status)} ${UI.badge(s.status)}</div>
          <div class="small muted">${E(s.session_date)} · ${E(s.slot)}</div>
          <div class="small muted">已约 ${s.booked}/${s.capacity} 人</div>
          <div style="margin-top:6px;display:flex;gap:6px">
            <button class="btn btn-sm" data-edit="${s.id}" data-cap="${s.capacity}">改容量</button>
            <button class="btn btn-sm" data-toggle="${s.id}" data-status="${E(s.status)}">
              ${s.status === '可预约' ? '先停办' : '重新开放'}</button></div></div>`).join('') : UI.empty('还没排场次');
      document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
        UI.sheet('改一下容量', `<div class="field"><label>这一场最多接多少人</label>
          <input class="input" id="cap" type="number" value="${b.dataset.cap}" min="1" /></div>
          <button class="btn btn-primary btn-block" id="go">改好</button>`, (m) => {
          m.querySelector('#go').onclick = async () => {
            try { await API.put('/api/merchant/sessions/' + b.dataset.edit,
              { capacity: Number(m.querySelector('#cap').value) }); m.remove(); UI.toast('改好了'); sessions(); }
            catch (e) { UI.toast(e.message); }
          };
        });
      });
      document.querySelectorAll('[data-toggle]').forEach((b) => b.onclick = async () => {
        try { await API.put('/api/merchant/sessions/' + b.dataset.toggle,
          { status: b.dataset.status === '可预约' ? '停办' : '可预约' });
          UI.toast('场次状态改好了'); sessions(); } catch (e) { UI.toast(e.message); }
      });
    };
    draw(list);
    document.getElementById('newBtn').onclick = () => {
      UI.sheet('排一场采摘', `<div class="field"><label>哪个园子</label><select class="select" id="oid">
          ${orchards.records.map((o) => `<option value="${o.id}">${E(o.name)}</option>`).join('')}</select></div>
        <div class="field"><label>哪一天</label><input class="input" type="date" id="date"
          value="${new Date(Date.now() + 86400000 * 3).toISOString().slice(0, 10)}" /></div>
        <div class="field"><label>哪个时段</label><select class="select" id="slot">
          <option>上午 09:00-11:30</option><option>下午 14:00-16:30</option></select></div>
        <div class="field"><label>最多接多少人</label><input class="input" type="number" id="cap" value="40" /></div>
        <button class="btn btn-primary btn-block" id="go">排上，等审核</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try {
            const r = await API.post('/api/merchant/sessions', {
              orchard_id: Number(m.querySelector('#oid').value),
              session_date: m.querySelector('#date').value,
              slot: m.querySelector('#slot').value,
              capacity: Number(m.querySelector('#cap').value) });
            m.remove(); UI.toast(r.tip); sessions();
          } catch (e) { UI.toast(e.message); }
        };
      });
    };
  }

  async function rooms() {
    document.getElementById('topSub').textContent = '房价和空房，随手改';
    const list = await API.get('/api/merchant/rooms');
    app.innerHTML = `<button class="btn btn-primary btn-block" id="newBtn">＋ 加个房型</button>
      <div class="section-head"><h3>在管的房间</h3><span class="more">共 ${list.length} 间</span></div>
      ${list.map((r) => `<div class="card" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between"><b class="small">${E(r.homestay_name)} · ${E(r.name)}</b>
          ${yuan(r.price)}<span class="small muted">/晚</span></div>
        <div class="small muted">可住 ${r.capacity} 人 · 还有 ${r.stock} 间</div>
        <button class="btn btn-sm" style="margin-top:6px" data-edit="${r.id}"
          data-price="${E(r.price)}" data-stock="${r.stock}">改价 / 改空房</button></div>`).join('')}`;
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      UI.sheet('调一下', `<div class="form-row">
        <div class="field"><label>一晚多少钱</label><input class="input" id="price" value="${b.dataset.price}" /></div>
        <div class="field"><label>还有几间</label><input class="input" id="stock" type="number" value="${b.dataset.stock}" /></div></div>
        <button class="btn btn-primary btn-block" id="go">改好</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try { await API.put('/api/merchant/rooms/' + b.dataset.edit,
            { price: m.querySelector('#price').value, stock: Number(m.querySelector('#stock').value) });
            m.remove(); UI.toast('改好了'); rooms(); } catch (e) { UI.toast(e.message); }
        };
      });
    });
    document.getElementById('newBtn').onclick = () => {
      UI.sheet('加个房型', `<div class="field"><label>房型名</label><input class="input" id="name" value="梅景小院" /></div>
        <div class="form-row"><div class="field"><label>一晚多少钱</label><input class="input" id="price" value="360" /></div>
        <div class="field"><label>几间房</label><input class="input" id="stock" type="number" value="2" /></div></div>
        <button class="btn btn-primary btn-block" id="go">加上</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try { await API.post('/api/merchant/rooms', { homestay_id: 1,
            name: m.querySelector('#name').value, price: m.querySelector('#price').value,
            stock: Number(m.querySelector('#stock').value) });
            m.remove(); UI.toast('加上了'); rooms(); } catch (e) { UI.toast(e.message); }
        };
      });
    };
  }

  async function products() {
    document.getElementById('topSub').textContent = '改价、补货、上下架';
    const d = await API.get('/api/merchant/products?pageSize=50');
    app.innerHTML = `<button class="btn btn-primary btn-block" id="newBtn">＋ 添件商品</button>
      <div class="section-head"><h3>在卖的和待审的</h3><span class="more">共 ${d.total} 件</span></div>
      ${d.records.map((p) => `<div class="card" style="margin-bottom:8px;display:flex;gap:10px">
        ${UI.img(p.image, 'img-1-1', 'style="width:64px;flex:0 0 64px"')}
        <div style="flex:1;min-width:0"><div class="small ellipsis"><b>${E(p.name)}</b></div>
          <div class="small muted">${yuan(p.price)} · 库里 ${p.stock} 件 · 已售 ${p.sales}</div>
          <div style="margin-top:4px">${UI.badge(p.audit_status)} ${UI.badge(p.shelf_status)}</div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn btn-sm" data-edit="${p.id}" data-price="${E(p.price)}" data-stock="${p.stock}">改价 / 补货</button>
            <button class="btn btn-sm" data-shelf="${p.id}" ${p.audit_status !== '已通过' ? 'disabled' : ''}>
              ${p.shelf_status === '上架' ? '先下架' : '上架卖'}</button></div></div></div>`).join('')}`;
    document.querySelectorAll('[data-edit]').forEach((b) => b.onclick = () => {
      UI.sheet('改一下', `<div class="form-row">
        <div class="field"><label>卖多少钱</label><input class="input" id="price" value="${b.dataset.price}" /></div>
        <div class="field"><label>补多少货</label><input class="input" id="stock" type="number" value="${b.dataset.stock}" /></div></div>
        <button class="btn btn-primary btn-block" id="go">改好</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try { await API.put('/api/merchant/products/' + b.dataset.edit,
            { price: m.querySelector('#price').value, stock: Number(m.querySelector('#stock').value) });
            m.remove(); UI.toast('改好了'); products(); } catch (e) { UI.toast(e.message); }
        };
      });
    });
    document.querySelectorAll('[data-shelf]').forEach((b) => b.onclick = async () => {
      try { const r = await API.put('/api/merchant/products/' + b.dataset.shelf, { action: 'shelf' });
        UI.toast(r.shelf_status === '上架' ? '上架了，能买了' : '先下架了'); products(); }
      catch (e) { UI.toast(e.message); }
    });
    document.getElementById('newBtn').onclick = () => {
      UI.sheet('添件商品', `<div class="field"><label>叫什么</label><input class="input" id="name" value="今夏新摘青梅" /></div>
        <div class="form-row"><div class="field"><label>卖多少钱</label><input class="input" id="price" value="29.90" /></div>
        <div class="field"><label>先备多少件</label><input class="input" id="stock" type="number" value="30" /></div></div>
        <button class="btn btn-primary btn-block" id="go">提交审核</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try { const r = await API.post('/api/merchant/products', {
            name: m.querySelector('#name').value, price: m.querySelector('#price').value,
            stock: Number(m.querySelector('#stock').value), category_id: 1 });
            m.remove(); UI.toast(r.tip); products(); } catch (e) { UI.toast(e.message); }
        };
      });
    };
  }

  async function orders() {
    document.getElementById('topSub').textContent = '谁下了单，该发货了';
    const d = await API.get('/api/merchant/orders?pageSize=50');
    app.innerHTML = `<div class="section-head"><h3>订单</h3><span class="more">共 ${d.total} 笔</span></div>
      ${d.records.length ? d.records.map((o) => `<div class="card" style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between"><b class="small">${E(o.order_no)}</b>${UI.badge(o.status)}</div>
        <div class="small muted">${E(o.receiver)} · ${E(o.phone)} · ${E(String(o.created_at).slice(0, 16))}</div>
        <div class="small muted ellipsis">${E(o.address)}</div>
        <div style="margin-top:6px">${yuan(o.amount)}
          ${o.status === '已支付' ? `<button class="btn btn-sm btn-primary" style="float:right" data-ship="${o.id}">发货</button>` : ''}
        </div></div>`).join('') : UI.empty('还没有订单')}`;
    document.querySelectorAll('[data-ship]').forEach((b) => b.onclick = async () => {
      try { const r = await API.post('/api/merchant/orders/' + b.dataset.ship + '/ship', {});
        UI.toast('发货了，' + r.status); orders(); } catch (e) { UI.toast(e.message); }
    });
  }

  async function checkin() {
    document.getElementById('topSub').textContent = '扫个码，这场就算办完了';
    const list = await API.get('/api/merchant/bookings');
    app.innerHTML = `<div class="card"><div class="field"><label>输码，或者点下面一条</label>
        <input class="input" id="code" placeholder="CK 开头的核销码" style="letter-spacing:1px" /></div>
      <button class="btn btn-primary btn-block" id="go">核销</button></div>
      <div class="section-head"><h3>等着核销的</h3><span class="more">${list.length} 条</span></div>
      ${list.length ? list.map((t) => `<div class="card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div><b class="small">${E(t.code)}</b> ${UI.badge(t.type_label)}
          <div class="small muted">${E(t.created_at.slice(0, 16))}</div></div>
        <button class="btn btn-sm" data-code="${E(t.checkin_code)}">${E(t.checkin_code)}</button></div>`).join('')
        : UI.empty('都核销完了')}`;
    const doCheck = async (code) => {
      try { const r = await API.post('/api/merchant/checkin', { checkin_code: code });
        UI.toast(r.tip); checkin(); } catch (e) { UI.toast(e.message); }
    };
    document.getElementById('go').onclick = () => doCheck(document.getElementById('code').value.trim());
    document.querySelectorAll('[data-code]').forEach((b) => b.onclick = () => doCheck(b.dataset.code));
  }

  const routes = { '/home': home, '/sessions': sessions, '/rooms': rooms,
    '/products': products, '/orders': orders, '/checkin': checkin, '/login': login };

  Router.on(async (path) => {
    syncAccount(); syncTab(path);
    if (path !== '/login' && !guard()) return;
    const handler = routes[path] || home;
    app.innerHTML = UI.loading();
    try { await handler(); } catch (e) {
      if (e.code === 401 || e.code === 403) { Router.go('/login'); return; }
      app.innerHTML = `<div class="card"><b>这页没打开</b><p class="small muted">${E(e.message)}</p>
        <a class="btn btn-sm" href="#/home">回工作台</a></div>`;
    }
    window.scrollTo(0, 0);
  });
})();
