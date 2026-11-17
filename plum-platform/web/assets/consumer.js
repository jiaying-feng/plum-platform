/* 消费者 PC 站：桌面版浏览、列表分页、双栏详情、购物车与下单、我的单据、集章、AI 抽屉。
   全部复用现有 /api、/api/ai 接口，不新增后端逻辑。 */
(function () {
  'use strict';

  const E = UI.esc;
  const app = document.getElementById('app');
  const FAV_KEY = 'plum_consumer_favs';

  const TYPES = {
    orchard: { name: '采摘园区', list: '/api/orchards', detail: '/api/orchards/', nav: 'orchards' },
    product: { name: '青梅好物', list: '/api/products', detail: '/api/products/', nav: 'shop' },
    research: { name: '研学课程', list: '/api/research', detail: '/api/research/', nav: 'research' },
    homestay: { name: '民宿住宿', list: '/api/homestays', detail: '/api/homestays/', nav: 'homestays' },
  };
  const TYPE_TO_LIST = { orchard: '/orchards', product: '/shop', research: '/research', homestay: '/homestays' };
  const NAV_OF = {
    home: 'home', orchards: 'orchards', orchard: 'orchards',
    research: 'research', homestays: 'homestays', homestay: 'homestays',
    shop: 'shop', product: 'shop', festivals: 'festivals', checkin: 'checkin',
  };

  const state = { page: 1, size: 12, keyword: '', category: '', town: '', sort: '', view: 'grid' };
  let current = null;

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayAfter(days) {
    const d = new Date(Date.now() + days * 86400000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function money(v) { return '¥' + E(v == null ? '' : v); }
  function priceOf(r, type) {
    if (type === 'orchard') return Number(r.adult_price || 0);
    return Number(r.price || 0);
  }

  function favs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch (e) { return []; }
  }
  function isFav(type, id) { return favs().some((x) => x.key === type + '_' + id); }
  function toggleFav(type, id, title) {
    const key = type + '_' + id;
    let list = favs().filter((x) => x && typeof x === 'object');
    const hit = list.some((x) => x.key === key);
    list = hit ? list.filter((x) => x.key !== key)
      : list.concat([{ key, type, id, title, typeName: TYPES[type].name }]);
    localStorage.setItem(FAV_KEY, JSON.stringify(list));
    UI.toast(hit ? '已取消收藏' : '收好了');
    return !hit;
  }
  function needLogin() { return PC.guard(['游客'], '/login'); }

  // ---------- 顶部与导航 ----------
  function syncTop() {
    const u = Session.user();
    const btn = document.getElementById('accountBtn');
    btn.textContent = u ? (u.nickname + ' · 退出') : '登录';
    btn.onclick = () => {
      if (!u) return Router.go('/login');
      PC.confirm('要退出消费者站吗？其它端的登录不受影响。', () => {
        API.post('/api/auth/logout').catch(() => {});
        Session.clear(); syncTop(); Router.go('/home');
      }, '退出');
    };
    updateCartCount();
  }

  function updateCartCount() {
    const box = document.getElementById('cartCount');
    if (!Session.id()) { box.textContent = '0'; return; }
    API.get('/api/cart').then((d) => {
      box.textContent = (d.items || []).length;
    }).catch(() => { box.textContent = '0'; });
  }

  function syncNav(path) {
    const key = path.split('/')[1] || 'home';
    const nav = NAV_OF[key] || '';
    document.querySelectorAll('#nav a').forEach((a) =>
      a.classList.toggle('on', a.dataset.nav === nav));
  }

  function render(html) { app.innerHTML = html; }
  function renderError(e) {
    render(PC.error(e && e.message ? e.message : '这页没打开'));
    PC.bindRetry(app, () => {
      if (current) Promise.resolve().then(current).catch(renderError);
    });
  }
  function crumb(items) {
    return PC.crumb([{ text: '首页', href: '#/home' }].concat(items));
  }

  // ---------- 首页 ----------
  async function home() {
    const d = await API.get('/api/home');
    const tip = d.season_tip || {};
    const banner = (d.banners || [])[0] || '';
    const quick = [
      { href: '#/orchards', label: '找园子', sub: '挑一场采摘' },
      { href: '#/shop', label: '逛集市', sub: '带点青梅回去' },
      { href: '#/research', label: '玩研学', sub: '亲手封一罐' },
      { href: '#/homestays', label: '住一晚', sub: '推窗是梅园' },
    ];
    render(`
      <div class="hero-banner">${UI.img(banner)}
        <div class="txt"><h2>${E(tip.title || '梅子熟了，上山走走')}</h2>
          <p>${E(tip.content || '摘梅、酿酒、住店，慢慢逛，别赶时间。')}</p></div></div>
      <div class="pc-section-title"><h2>从哪儿开始</h2></div>
      <div class="pc-stat-grid">${quick.map((q) => `
        <a class="pc-stat" href="${E(q.href)}" style="display:block">
          <div class="label">${E(q.sub)}</div><div class="value" style="font-size:20px">${E(q.label)}</div></a>`).join('')}</div>

      <div class="pc-section-title"><h2>可以去的园子</h2>
        <a class="more" href="#/orchards">看全部 →</a></div>
      <div class="pc-grid g-3">${(d.orchards || []).slice(0, 3).map((o) => PC.productCard(o, {
        href: '#/orchard/' + o.id, desc: o.town + ' · ' + o.address,
        priceText: '大人 ' + money(o.adult_price), tag: o.open_time || '采摘',
      })).join('')}</div>

      <div class="pc-section-title"><h2>青梅园分布</h2>
        <a class="more" href="#/checkin">集章地图 →</a></div>
      <div class="map-box">${PlumMap.html(d.orchards || [])}</div>

      <div class="pc-section-title"><h2>镇上的好物</h2>
        <a class="more" href="#/shop">看全部 →</a></div>
      <div class="pc-grid">${(d.products || []).slice(0, 4).map((p) => PC.productCard(p, {
        href: '#/product/' + p.id, desc: p.subtitle, priceText: money(p.price), tag: '已售 ' + (p.sales || 0),
      })).join('')}</div>

      <div class="pc-section-title"><h2>带娃来玩</h2>
        <a class="more" href="#/research">看全部 →</a></div>
      <div class="pc-grid g-3">${(d.research || []).slice(0, 3).map((r) => PC.productCard(r, {
        href: '#/research/' + r.id, desc: (r.start_date || '') + ' 开课',
        priceText: money(r.price) + ' /人', tag: '研学',
      })).join('')}</div>`);
    PlumMap.bind(document, d.orchards || [], (o) => { location.href = '#/orchard/' + o.id; });
  }

  // ---------- 列表 ----------
  async function fetchList(type) {
    const cfg = TYPES[type];
    const q = { pageNum: state.page, pageSize: state.size, keyword: state.keyword };
    if (type === 'product' && state.category) q.category_id = state.category;
    if (type === 'orchard' && state.town) q.town = state.town;
    const d = await API.get(cfg.list + PC.qs(q));
    return Array.isArray(d) ? PC.clientPage(d, state.page, state.size) : d;
  }

  function sortRows(rows, type) {
    const list = rows.slice();
    if (state.sort === 'priceAsc') list.sort((a, b) => priceOf(a, type) - priceOf(b, type));
    else if (state.sort === 'priceDesc') list.sort((a, b) => priceOf(b, type) - priceOf(a, type));
    else if (state.sort === 'name') list.sort((a, b) =>
      String(a.name || a.title || '').localeCompare(String(b.name || b.title || ''), 'zh'));
    return list;
  }

  function cardFor(type, r) {
    const cfg = TYPES[type];
    const href = '#/' + (type === 'orchard' ? 'orchard' : type === 'product' ? 'product' :
      type === 'research' ? 'research' : 'homestay') + '/' + r.id;
    let desc, priceText, tag, action = '';
    if (type === 'product') {
      desc = r.subtitle; priceText = money(r.price); tag = '库 ' + (r.stock || 0);
      action = `<button class="btn btn-sm" data-add="${E(r.id)}">加购</button>`;
    } else if (type === 'orchard') {
      desc = r.town + ' · ' + r.address; priceText = '大人 ' + money(r.adult_price); tag = r.open_time || '采摘';
    } else if (type === 'research') {
      desc = (r.start_date || '') + ' 开课'; priceText = money(r.price) + ' /人';
      tag = '余 ' + Math.max(0, (r.capacity || 0) - (r.signed || 0)) + ' 位';
    } else {
      desc = r.town + ' · ' + r.address; priceText = '可预订'; tag = '住宿';
    }
    return PC.productCard(r, { href, desc, priceText, tag, action });
  }

  function tableFor(type, rows) {
    const cols = [
      { title: '名称', key: 'name', render: (r) => {
        const href = '#/' + (type === 'orchard' ? 'orchard' : type === 'product' ? 'product' :
          type === 'research' ? 'research' : 'homestay') + '/' + r.id;
        return `<a class="clip" href="${E(href)}" style="display:block">${E(r.name || r.title || '')}</a>`;
      } },
      { title: '说明', key: 'subtitle', render: (r) =>
        `<span class="small muted clip" style="display:block">${E(r.subtitle || r.address || r.intro || '')}</span>` },
      { title: '价格', key: 'price', align: 'right', render: (r) =>
        `<span class="price">${type === 'orchard' ? '大人 ' + money(r.adult_price) : money(r.price)}</span>` },
      { title: '操作', key: 'id', width: '120px', render: (r) => {
        const href = '#/' + (type === 'orchard' ? 'orchard' : type === 'product' ? 'product' :
          type === 'research' ? 'research' : 'homestay') + '/' + r.id;
        return `<a class="btn btn-sm" href="${E(href)}">看详情</a>`;
      } },
    ];
    return PC.table(cols, rows, { empty: '没找到符合条件的，换个词试试' });
  }

  async function listPage(type) {
    const cfg = TYPES[type];
    const cats = type === 'product' ? await API.get('/api/categories').catch(() => []) : [];
    const d = await fetchList(type);
    drawList(type, cats, d);
  }

  function drawList(type, cats, d) {
    const cfg = TYPES[type];
    const rows = sortRows(d.records || [], type);
    const catOptions = [{ value: '', text: '全部分类' }].concat((cats || []).map((c) =>
      ({ value: c.id, text: c.name })));
    const townOptions = [{ value: '', text: '全部乡镇' }].concat(
      ['䢺江镇', '安仁镇', '西岭镇'].map((t) => ({ value: t, text: t })));
    const toolbar = `<div class="pc-toolbar">
      <input class="input grow" id="kw" value="${E(state.keyword)}" placeholder="搜${E(cfg.name)}…" aria-label="关键词" />
      ${type === 'product' ? `<select class="select" id="cat" aria-label="分类">${catOptions.map((o) =>
        `<option value="${E(o.value)}" ${String(o.value) === String(state.category) ? 'selected' : ''}>${E(o.text)}</option>`).join('')}</select>` : ''}
      ${type === 'orchard' ? `<select class="select" id="town" aria-label="乡镇">${townOptions.map((o) =>
        `<option value="${E(o.value)}" ${o.value === state.town ? 'selected' : ''}>${E(o.text)}</option>`).join('')}</select>` : ''}
      <select class="select" id="sort" aria-label="本页排序">
        <option value="" ${state.sort === '' ? 'selected' : ''}>默认排序</option>
        <option value="priceAsc" ${state.sort === 'priceAsc' ? 'selected' : ''}>价格从低到高</option>
        <option value="priceDesc" ${state.sort === 'priceDesc' ? 'selected' : ''}>价格从高到低</option>
        <option value="name" ${state.sort === 'name' ? 'selected' : ''}>按名称</option>
      </select>
      <button class="btn btn-primary" id="doSearch">搜索</button>
      <button class="btn" id="doReset">重置</button>
      <span class="spacer"></span>
      <button class="btn btn-sm ${state.view === 'grid' ? 'on' : ''}" id="viewGrid">卡片</button>
      <button class="btn btn-sm ${state.view === 'table' ? 'on' : ''}" id="viewTable">表格</button>
    </div>`;
    const body = state.view === 'table' ? tableFor(type, rows)
      : (rows.length ? `<div class="pc-grid">${rows.map((r) => cardFor(type, r)).join('')}</div>`
        : PC.empty('没找到符合条件的，换个词试试'));
    render(crumb([{ text: cfg.name }]) + toolbar +
      `<div class="pc-hint">共 ${E(d.total || 0)} 条${state.sort ? ' · 当前为本页排序' : ''}</div>` +
      body + PC.pager(d.current || state.page, d.size || state.size, d.total || 0));

    const q = (id) => app.querySelector('#' + id);
    const search = () => {
      state.keyword = q('kw').value.trim();
      if (q('cat')) state.category = q('cat').value;
      if (q('town')) state.town = q('town').value;
      state.sort = q('sort').value;
      state.page = 1;
      refreshList(type);
    };
    q('doSearch').onclick = search;
    PC.onEnter(q('kw'), search);
    q('doReset').onclick = () => {
      state.keyword = ''; state.category = ''; state.town = ''; state.sort = ''; state.page = 1;
      refreshList(type);
    };
    q('sort').onchange = search;
    if (q('cat')) q('cat').onchange = search;
    if (q('town')) q('town').onchange = search;
    q('viewGrid').onclick = () => { state.view = 'grid'; drawList(type, cats, d); };
    q('viewTable').onclick = () => { state.view = 'table'; drawList(type, cats, d); };
    PC.bindPager(app, (p) => { state.page = p; refreshList(type); });
    app.querySelectorAll('[data-add]').forEach((b) => {
      b.onclick = () => addCart(b.dataset.add, 1);
    });
  }

  async function refreshList(type) {
    app.innerHTML = PC.loading('正在翻列表…');
    try { drawList(type, type === 'product' ? await API.get('/api/categories').catch(() => []) : [],
      await fetchList(type)); }
    catch (e) { renderError(e); }
  }

  // ---------- 详情 ----------
  async function detail(type, id) {
    const cfg = TYPES[type];
    if (!id) throw new Error('缺少编号');
    const d = await API.get(cfg.detail + id);
    const title = d.name || d.title || '未命名';
    let priceText = '', meta = '', form = '', tabs = '';

    if (type === 'product') {
      priceText = money(d.price);
      meta = `<dt>副标题</dt><dd>${E(d.subtitle || '')}</dd>
        <dt>库存 / 销量</dt><dd>${E(d.stock)} 件 / 已售 ${E(d.sales)} 件</dd>
        <dt>分类</dt><dd>${E(d.category_name || '青梅好物')}</dd>`;
      form = `<div class="pc-form">
        <div class="pc-field"><label>买几件</label>
          <input class="input" type="number" id="qty" min="1" max="99" value="1" /></div>
        <div class="pc-form-actions">
          <button class="btn" id="addCart">放进购物车</button>
          <button class="btn btn-primary" id="buyNow">立即购买</button></div></div>`;
    } else if (type === 'orchard') {
      priceText = '大人 ' + money(d.adult_price) + ' <span class="small muted">/ 小孩 ' + money(d.child_price) + '</span>';
      meta = `<dt>地址</dt><dd>${E(d.town || '')} ${E(d.address || '')}</dd>
        <dt>开放时间</dt><dd>${E(d.open_time || '')}</dd>
        <dt>门票</dt><dd>含两斤梅子带走</dd>`;
      const sessions = d.sessions || [];
      form = `<div class="pc-form">
        <div class="pc-field"><label>选一场</label>
          <select class="select" id="session">${sessions.length ? sessions.map((s) =>
            `<option value="${E(s.id)}">${E(s.date)} ${E(s.slot)} · 余 ${E(s.left)} 位</option>`).join('')
            : '<option value="">这园子暂时没排场次</option>'}</select></div>
        <div class="pc-field"><label>几个人（1-20）</label>
          <input class="input" type="number" id="people" min="1" max="20" value="2" /></div>
        <div class="pc-field"><label>联系人</label><input class="input" id="contact" value="小梅" /></div>
        <div class="pc-field"><label>手机号（11 位）</label><input class="input" id="phone" value="13700000001" /></div>
        <div class="pc-form-actions"><button class="btn btn-primary" id="doBook">约一场</button></div></div>`;
      tabs = sessions.length ? `<div class="detail-tabs"><button class="on" data-tab="intro">说两句</button>
        <button data-tab="sessions">场次余位</button></div>
        <div id="tabBody"><div class="card">${E(d.intro || '')}</div></div>` : '';
    } else if (type === 'research') {
      priceText = money(d.price) + ' <span class="small muted">/人</span>';
      meta = `<dt>开课日期</dt><dd>${E(d.start_date || '')} — ${E(d.end_date || '')}</dd>
        <dt>名额</dt><dd>共 ${E(d.capacity)} 位，已报 ${E(d.signed)} 位</dd>
        <dt>状态</dt><dd>${E(d.status || '报名中')}</dd>`;
      form = `<div class="pc-form">
        <div class="pc-field"><label>几个人（1-10）</label>
          <input class="input" type="number" id="people" min="1" max="10" value="1" /></div>
        <div class="pc-field"><label>联系人</label><input class="input" id="contact" value="小梅" /></div>
        <div class="pc-field"><label>手机号（11 位）</label><input class="input" id="phone" value="13700000001" /></div>
        <div class="pc-form-actions"><button class="btn btn-primary" id="doBook">报个名</button></div></div>`;
    } else {
      priceText = '可预订';
      meta = `<dt>地址</dt><dd>${E(d.town || '')} ${E(d.address || '')}</dd>
        <dt>介绍</dt><dd>${E(d.intro || '')}</dd>`;
      const rooms = d.rooms || [];
      form = `<div class="pc-form">
        <div class="pc-field"><label>房型</label>
          <select class="select" id="room">${rooms.length ? rooms.map((r) =>
            `<option value="${E(r.id)}">${E(r.name)} · ${money(r.price)}/晚 · 可住 ${E(r.capacity)} 人 · 余 ${E(r.stock)} 间</option>`).join('')
            : '<option value="">暂时没有可订房型</option>'}</select></div>
        <div class="pc-field"><label>入住</label>
          <input class="input" type="date" id="checkIn" value="${E(dayAfter(1))}" /></div>
        <div class="pc-field"><label>离店</label>
          <input class="input" type="date" id="checkOut" value="${E(dayAfter(2))}" /></div>
        <div class="pc-field"><label>住几个人</label>
          <input class="input" type="number" id="guests" min="1" max="10" value="2" /></div>
        <div class="pc-field"><label>联系人</label><input class="input" id="contact" value="小梅" /></div>
        <div class="pc-field"><label>手机号（11 位）</label><input class="input" id="phone" value="13700000001" /></div>
        <div class="pc-form-actions"><button class="btn btn-primary" id="doBook">订一晚</button></div></div>`;
      tabs = rooms.length ? `<div class="detail-tabs"><button class="on" data-tab="intro">说两句</button>
        <button data-tab="rooms">房型一览</button></div>
        <div id="tabBody"><div class="card">${E(d.intro || '')}</div></div>` : '';
    }

    render(crumb([{ text: cfg.name, href: '#' + TYPE_TO_LIST[type] }, { text: title }]) + `
      <div class="detail-layout">
        <div class="detail-main">
          ${UI.img(d.image, 'img img-16-9')}
          <div class="card" style="margin-top:16px">
            <h2 style="font-size:22px">${E(title)}</h2>
            <div class="small muted" style="margin-top:6px">${E(d.intro || d.subtitle || '自家做的，慢慢逛，别赶时间。')}</div>
            <dl class="detail-meta">${meta}</dl>
          </div>
          ${tabs}
        </div>
        <div class="detail-side"><div class="card">
          <div class="small muted">${E(cfg.name)}</div>
          <div class="detail-price">${priceText}</div>
          ${form}
          <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:14px">
            <button class="btn btn-block" id="favBtn">${isFav(type, id) ? '已收好' : '收着'}</button>
          </div>
        </div></div>
      </div>`);

    bindDetail(type, d, title, id);
  }

  function val(id) {
    const el = app.querySelector('#' + id);
    return el ? String(el.value || '').trim() : '';
  }
  function validPhone(v) { return /^\d{11}$/.test(v); }

  function bindDetail(type, d, title, id) {
    const favBtn = app.querySelector('#favBtn');
    if (favBtn) favBtn.onclick = () => {
      const on = toggleFav(type, id, title);
      favBtn.textContent = on ? '已收好' : '收着';
    };

    const tabBtns = app.querySelectorAll('.detail-tabs button');
    if (tabBtns.length) {
      const panels = {
        intro: `<div class="card">${E(d.intro || d.subtitle || '慢慢逛，别赶时间。')}</div>`,
        sessions: PC.table([
          { title: '日期', key: 'date' }, { title: '时段', key: 'slot' },
          { title: '余位', key: 'left', align: 'right' },
        ], d.sessions || [], { empty: '还没排场次' }),
        rooms: PC.table([
          { title: '房型', key: 'name' }, { title: '可住', key: 'capacity', align: 'right' },
          { title: '价格', key: 'price', align: 'right', render: (r) => `<span class="price">${money(r.price)}</span>` },
          { title: '余房', key: 'stock', align: 'right' },
        ], d.rooms || [], { empty: '还没有房型' }),
      };
      tabBtns.forEach((b) => {
        b.onclick = () => {
          tabBtns.forEach((x) => x.classList.remove('on'));
          b.classList.add('on');
          const body = app.querySelector('#tabBody');
          if (body) body.innerHTML = panels[b.dataset.tab] || panels.intro;
        };
      });
    }

    const add = app.querySelector('#addCart');
    if (add) add.onclick = () => addCart(id, Number(val('qty')) || 1);
    const buy = app.querySelector('#buyNow');
    if (buy) buy.onclick = async () => {
      if (!needLogin()) return;
      const ok = await addCart(id, Number(val('qty')) || 1, true);
      if (ok) Router.go('/cart');
    };

    const book = app.querySelector('#doBook');
    if (book) book.onclick = async () => {
      if (!needLogin()) return;
      const contact = val('contact'), phone = val('phone');
      if (!contact || !validPhone(phone)) { UI.toast('联系人和 11 位手机号都要填对'); return; }
      book.disabled = true;
      try {
        let task;
        if (type === 'orchard') {
          const sid = val('session');
          if (!sid) throw new Error('这园子暂时没排场次');
          task = API.post('/api/reservations', {
            session_id: Number(sid), people: Number(val('people')) || 1,
            contact, phone, requestId: PC.requestId(),
          });
        } else if (type === 'research') {
          task = API.post('/api/research/signup', {
            research_id: Number(id), people: Number(val('people')) || 1,
            contact, phone, requestId: PC.requestId(),
          });
        } else {
          const room = val('room');
          if (!room) throw new Error('这家暂时没有可订房型');
          task = API.post('/api/homestay-bookings', {
            homestay_id: Number(id), room_id: Number(room), guests: Number(val('guests')) || 1,
            check_in: val('checkIn'), check_out: val('checkOut'),
            contact, phone, requestId: PC.requestId(),
          });
        }
        const r = await task;
        showResult(r, '手续办好了');
      } catch (e) { UI.toast(e.message || '没办成，稍后再试'); }
      finally { book.disabled = false; }
    };
  }

  function showResult(r, title) {
    PC.modal(title, `<div class="card" style="background:#eaf4ea;border-color:#cfe5cf">
      <div class="strong">${E(r.tip || '到场出示核销码就能用')}</div>
      <div class="small" style="margin-top:8px">单号 ${E(r.order_no || r.code || '')}</div>
      <div class="small">金额 ${money(r.amount)} · ${E(r.status || '')}</div>
      ${r.checkin_code ? `<div class="strong" style="font-size:26px;letter-spacing:2px;margin-top:12px">${E(r.checkin_code)}</div>` : ''}
      </div><div class="pc-form-actions"><button class="btn btn-primary" data-close>知道了</button></div>`);
  }

  async function addCart(id, qty, quiet) {
    if (!needLogin()) return false;
    try {
      await API.post('/api/cart', { product_id: Number(id), quantity: Math.max(1, Number(qty) || 1) });
      if (!quiet) UI.toast('放进购物车了');
      updateCartCount();
      return true;
    } catch (e) { UI.toast(e.message || '没加进去'); return false; }
  }

  // ---------- 购物车与下单 ----------
  async function cart() {
    const d = await API.get('/api/cart');
    const items = d.items || [];
    const cols = [
      { title: '商品', key: 'name', render: (r) => `<div style="display:flex;gap:10px;align-items:center">
        ${UI.img(r.image, 'img-1-1', 'style="width:48px;height:48px;flex:0 0 48px"')}
        <div><div class="strong">${E(r.name)}</div><div class="small muted">${E(r.subtitle || '')}</div></div></div>` },
      { title: '单价', key: 'price', align: 'right', render: (r) => `<span class="price">${money(r.price)}</span>` },
      { title: '数量', key: 'id', width: '120px', render: (r) =>
        `<input class="input" type="number" min="1" max="99" value="${E(r.quantity)}" data-qty="${E(r.id)}" style="width:84px" />` },
      { title: '小计', key: 'id', align: 'right', render: (r) =>
        `<span class="price">${money((Number(r.price) * r.quantity).toFixed(2))}</span>` },
      { title: '操作', key: 'id', width: '90px', render: (r) =>
        `<button class="btn btn-sm" data-del="${E(r.id)}">移除</button>` },
    ];
    render(crumb([{ text: '购物车' }]) + `<h2 style="font-size:22px;margin-bottom:16px">购物车</h2>` +
      PC.table(cols, items, { empty: '购物车还是空的，先去逛逛' }) +
      `<div class="card" style="margin-top:16px;display:flex;align-items:center;justify-content:space-between">
        <div class="small muted">共 ${items.length} 件</div>
        <div style="display:flex;align-items:center;gap:18px">
          <div>合计 <span class="price" style="font-size:22px">${money(d.total)}</span></div>
          <a class="btn" href="#/shop">接着逛</a>
          <button class="btn btn-primary" id="toCheckout" ${items.length ? '' : 'disabled'}>去结算</button>
        </div></div>`);
    app.querySelectorAll('[data-qty]').forEach((el) => {
      el.onchange = async () => {
        try {
          await API.put('/api/cart/' + el.dataset.qty, { quantity: Math.max(1, Number(el.value) || 1) });
          await cart(); updateCartCount();
        } catch (e) { UI.toast(e.message); }
      };
    });
    app.querySelectorAll('[data-del]').forEach((el) => {
      el.onclick = async () => {
        try { await API.del('/api/cart/' + el.dataset.del); await cart(); updateCartCount(); }
        catch (e) { UI.toast(e.message); }
      };
    });
    const go = app.querySelector('#toCheckout');
    if (go) go.onclick = () => Router.go('/checkout');
  }

  async function checkout() {
    const d = await API.get('/api/cart');
    const items = d.items || [];
    if (!items.length) {
      render(crumb([{ text: '结算' }]) + PC.empty('购物车还是空的') +
        `<div style="text-align:center"><a class="btn btn-primary" href="#/shop">去挑点东西</a></div>`);
      return;
    }
    const fields = [
      { name: 'receiver', label: '收货人', required: true, value: '小梅' },
      { name: 'phone', label: '手机号', required: true, value: '13700000001' },
      { name: 'address', label: '收货地址', required: true, value: '大邑县䢺江镇游客中心' },
    ];
    render(crumb([{ text: '购物车', href: '#/cart' }, { text: '结算' }]) + `
      <h2 style="font-size:22px;margin-bottom:16px">填一下收货信息</h2>
      <div class="checkout-layout">
        <div class="card">
          ${PC.form(fields)}
          <div class="pc-form-actions"><button class="btn btn-primary" id="submitOrder">提交订单</button></div>
        </div>
        <div class="card">
          <h3 class="card-title">订单摘要</h3>
          ${items.map((i) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:6px 0">
            <span class="clip">${E(i.name)} × ${E(i.quantity)}</span>
            <span class="price">${money((Number(i.price) * i.quantity).toFixed(2))}</span></div>`).join('')}
          <div style="border-top:1px solid var(--line);margin-top:10px;padding-top:10px;display:flex;justify-content:space-between">
            <b>合计</b><span class="price" style="font-size:20px">${money(d.total)}</span></div>
        </div>
      </div>`);
    const btn = app.querySelector('#submitOrder');
    btn.onclick = async () => {
      if (!PC.validate(app, fields)) return;
      const v = PC.readForm(app, fields);
      if (!validPhone(v.phone)) { UI.toast('手机号要填 11 位数字'); return; }
      btn.disabled = true;
      try {
        const order = await API.post('/api/orders', {
          receiver: v.receiver, phone: v.phone, address: v.address, requestId: PC.requestId(),
        });
        updateCartCount();
        PC.modal('下单成功', `<div class="card" style="background:#eaf4ea;border-color:#cfe5cf">
            <div class="strong">单号 ${E(order.order_no)}</div>
            <div class="small" style="margin-top:6px">金额 ${money(order.amount)} · ${E(order.status)}</div>
          </div><div class="pc-form-actions">
            <button class="btn" id="laterPay">稍后再说</button>
            <button class="btn btn-primary" id="payNow">现在支付</button></div>`,
        (el, close) => {
          el.querySelector('#laterPay').onclick = () => { close(); Router.go('/mine'); };
          el.querySelector('#payNow').onclick = async () => {
            try {
              await API.post('/api/orders/' + order.id + '/pay', {});
              close(); UI.toast('付好啦'); Router.go('/mine');
            } catch (e) { UI.toast(e.message); }
          };
        });
      } catch (e) { UI.toast(e.message || '没提交成'); }
      finally { btn.disabled = false; }
    };
  }

  // ---------- 我的 ----------
  async function mine() {
    const [ov, orders, resv] = await Promise.all([
      API.get('/api/my/overview'), API.get('/api/my/orders'), API.get('/api/my/reservations'),
    ]);
    const c = ov.counts || {};
    const orderCols = [
      { title: '单号', key: 'order_no' },
      { title: '金额', key: 'amount', align: 'right', render: (r) => `<span class="price">${money(r.amount)}</span>` },
      { title: '下单时间', key: 'created_at' },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
      { title: '商品', key: 'items', render: (r) => (r.items || []).map((i) =>
        `${E(i.name)} × ${E(i.quantity)}`).join('、') || '<span class="muted small">—</span>' },
      { title: '操作', key: 'id', width: '160px', render: (r) => r.status === '待支付'
        ? `<div class="row-actions"><button class="btn btn-sm" data-cancel="${E(r.id)}">取消</button>
           <button class="btn btn-sm btn-primary" data-pay="${E(r.id)}">支付</button></div>`
        : '<span class="muted small">—</span>' },
    ];
    const resvCols = [
      { title: '预约号', key: 'code' },
      { title: '园子', key: 'orchard_name' },
      { title: '日期 / 时段', key: 'visit_date', render: (r) => `${E(r.visit_date)} ${E(r.slot || '')}` },
      { title: '人数', key: 'people', align: 'right' },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
      { title: '核销码', key: 'checkin_code', render: (r) => `<b>${E(r.checkin_code || '')}</b>` },
    ];
    const favList = favs().filter((x) => x && typeof x === 'object');
    render(crumb([{ text: '我的' }]) + `
      <h2 style="font-size:22px;margin-bottom:16px">${E(ov.nickname || Session.user().nickname)} 的青梅账本</h2>
      ${PC.stat([
        { label: '订单', value: c.orders || 0 }, { label: '采摘预约', value: c.reservations || 0 },
        { label: '研学报名', value: c.research || 0 }, { label: '集章', value: c.stamps || 0 },
      ])}
      <div class="pc-section-title"><h2>手上的核销码</h2><span class="more">到场给店家看</span></div>
      ${(ov.bookings || []).length ? `<div class="pc-grid">${ov.bookings.map((b) => `
        <div class="card"><div class="small muted">${E(b.type === 'reservation' ? '采摘' : b.type === 'research' ? '研学' : '住店')} · ${E(b.date || '')}</div>
          <div class="strong" style="margin-top:6px">${E(b.code)}</div>
          <div class="strong" style="font-size:20px;letter-spacing:2px;margin-top:8px">${E(b.checkin_code)}</div>
          <div style="margin-top:8px">${UI.badge(b.status)}</div></div>`).join('')}</div>`
        : PC.empty('还没有要核销的单子')}
      <div class="pc-section-title"><h2>买过的东西</h2><span class="more">${orders.length} 笔</span></div>
      ${PC.table(orderCols, orders, { empty: '还没下过单' })}
      <div class="pc-section-title"><h2>采摘预约</h2><span class="more">${resv.length} 条</span></div>
      ${PC.table(resvCols, resv, { empty: '还没约过采摘' })}
      <div class="pc-section-title"><h2>收着的</h2><span class="more">${favList.length} 条</span></div>
      ${favList.length ? `<div class="pc-grid">${favList.map((f) => `
        <a class="card" href="#/${f.type === 'orchard' ? 'orchard' : f.type === 'product' ? 'product' :
          f.type === 'research' ? 'research' : 'homestay'}/${E(f.id)}">
          <b>${E(f.title)}</b><div class="small muted">${E(f.typeName)} · 点开看看</div></a>`).join('')}</div>`
        : PC.empty('在详情页点「收着」就存到这儿了')}`);

    app.querySelectorAll('[data-pay]').forEach((b) => {
      b.onclick = async () => {
        try { await API.post('/api/orders/' + b.dataset.pay + '/pay', {}); UI.toast('付好啦'); await mine(); }
        catch (e) { UI.toast(e.message); }
      };
    });
    app.querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = () => PC.confirm('取消这笔单？库存会退回去。', async () => {
        try { await API.post('/api/orders/' + b.dataset.cancel + '/cancel', {}); UI.toast('取消了'); await mine(); }
        catch (e) { UI.toast(e.message); }
      }, '取消订单');
    });
  }

  // ---------- 节庆 / 集章 ----------
  async function festivals() {
    const list = await API.get('/api/festivals');
    render(crumb([{ text: '节庆活动' }]) + `<h2 style="font-size:22px;margin-bottom:16px">镇上的节庆</h2>` +
      (list.length ? `<div class="pc-grid g-2">${list.map((f) => `
        <div class="card"><div style="display:flex;justify-content:space-between;align-items:center">
          <h3 class="card-title" style="margin:0">${E(f.title)}</h3>${UI.badge(f.status)}</div>
          <div class="small muted" style="margin-top:8px">${E(f.festival_date)} · ${E(f.place)}</div>
          <div class="small" style="margin-top:10px">${E(f.intro)}</div></div>`).join('')}</div>`
        : PC.empty('最近没有活动')));
  }

  async function checkinPage() {
    const d = await API.get('/api/checkin-spots');
    const spots = d.spots || [];
    const cols = [
      { title: '打卡点', key: 'name', render: (r) => `<b>${E(r.name)}</b><div class="small muted">${E(r.spot_type || '')}</div>` },
      { title: '介绍', key: 'intro', render: (r) => `<span class="small">${E(r.intro || '')}</span>` },
      { title: '状态', key: 'stamped', render: (r) => r.stamped ? UI.badge('已盖章') : UI.badge('未盖章') },
      { title: '操作', key: 'id', width: '110px', render: (r) => r.stamped
        ? '<span class="muted small">—</span>' : `<button class="btn btn-sm btn-primary" data-stamp="${E(r.id)}">盖一枚</button>` },
    ];
    const doneIds = spots.filter((s) => s.stamped).map((s) => s.id);
    render(crumb([{ text: '集章地图' }]) + `
      <h2 style="font-size:22px;margin-bottom:6px">已经集了 ${E(d.stamped)} / ${E(d.total)} 枚</h2>
      <div class="pc-hint">一天同一个点只盖一次，六枚集齐到游客中心换一份伴手礼。</div>
      <div class="checkout-layout">
        <div class="map-box">${PlumMap.html(spots, { doneIds })}</div>
        <div>${PC.table(cols, spots, { empty: '点位还没加载出来' })}</div>
      </div>`);
    PlumMap.bind(app, spots, (s) => UI.toast(s.name + ' · ' + (s.intro || '')));
    app.querySelectorAll('[data-stamp]').forEach((b) => {
      b.onclick = async () => {
        if (!needLogin()) return;
        try {
          const r = await API.post('/api/checkin', { spot_id: Number(b.dataset.stamp) });
          UI.toast(r.tip || '盖好了'); await checkinPage();
        } catch (e) { UI.toast(e.message); }
      };
    });
  }

  // ---------- 登录 ----------
  function login() {
    const fields = [
      { name: 'username', label: '账号', required: true, value: 'tourist01' },
      { name: 'password', label: '口令', type: 'password', required: true, value: 'tourist123' },
    ];
    render(crumb([{ text: '登录' }]) + `
      <div class="card" style="max-width:520px;margin:28px auto">
        <h2 style="font-size:20px">登录消费者站</h2>
        ${PC.form(fields)}
        <div class="pc-form-actions"><button class="btn btn-primary" id="doLogin">登录</button></div>
      </div>`);
    const btn = app.querySelector('#doLogin');
    const submit = async () => {
      if (!PC.validate(app, fields)) return;
      const v = PC.readForm(app, fields);
      btn.disabled = true;
      try {
        const d = await API.post('/api/auth/login', {
          username: v.username, password: v.password, role: '游客',
        });
        Session.set(d.sessionId, { nickname: d.nickname, role: d.role });
        syncTop(); UI.toast('回来了，' + d.nickname); Router.go('/home');
      } catch (e) { UI.toast(e.message || '没登上去'); }
      finally { btn.disabled = false; }
    };
    btn.onclick = submit;
    PC.onEnter(app.querySelector('.pc-form'), submit);
  }

  // ---------- AI 抽屉 ----------
  function openAI() {
    const html = `<div class="small muted" style="margin-bottom:12px">园子、场次、房价都从平台实时账本里查，不瞎编。</div>
      <div class="ai-quick">${['青梅酒多少钱？', '周末还有位置吗？', '住一晚多少钱？'].map((q) =>
        `<button class="btn" data-q="${E(q)}">${E(q)}</button>`).join('')}</div>
      <div id="aiLog"></div>
      <div style="position:sticky;bottom:0;background:#fff;padding-top:12px;display:flex;gap:8px">
        <input class="input" id="aiInput" placeholder="想问啥，直接说" aria-label="提问" />
        <button class="btn btn-primary" id="aiSend">问</button>
      </div>
      <div style="margin-top:12px"><button class="btn btn-sm" id="aiPlan">排一个两日行程</button></div>`;
    PC.drawer('问小梅', html, (el) => {
      const log = el.querySelector('#aiLog');
      const input = el.querySelector('#aiInput');
      const add = (text, me) => {
        const box = document.createElement('div');
        box.className = 'ai-q' + (me ? ' me' : '');
        box.textContent = text;
        log.appendChild(box);
        log.parentElement.scrollTop = log.parentElement.scrollHeight;
      };
      const ask = async (q) => {
        if (!q) return;
        add(q, true);
        input.value = '';
        try {
          const d = await API.post('/api/ai/chat', { question: q });
          add(d.answer + (d.source ? '\n依据：' + d.source : ''), false);
        } catch (e) { add('这会儿没连上：' + e.message, false); }
      };
      el.querySelectorAll('[data-q]').forEach((b) => { b.onclick = () => ask(b.dataset.q); });
      el.querySelector('#aiSend').onclick = () => ask(input.value.trim());
      PC.onEnter(input, () => ask(input.value.trim()));
      el.querySelector('#aiPlan').onclick = async () => {
        add('帮我排一个两日行程', true);
        try {
          const d = await API.post('/api/ai/itinerary', { days: 2 });
          add(d.itinerary, false);
        } catch (e) { add('没排成：' + e.message, false); }
      };
    });
  }

  // ---------- 全局搜索 ----------
  function doSearch() {
    state.keyword = document.getElementById('globalSearch').value.trim();
    state.page = 1; state.category = ''; state.town = '';
    if ((location.hash || '') === '#/shop') listPage('product').catch(renderError);
    else Router.go('/shop');
  }
  document.getElementById('searchBtn').onclick = doSearch;
  document.getElementById('globalSearch').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doSearch();
  });
  document.getElementById('aiFab').onclick = openAI;

  // ---------- 路由 ----------
  PC.syncGuardEvent('/login');
  Router.on(async (path) => {
    syncTop(); syncNav(path);
    const parts = path.split('/');
    const seg = parts[1] || 'home';
    let fn = null, args = [];
    if (seg === 'home') fn = home;
    else if (seg === 'orchards') fn = () => listPage('orchard');
    else if (seg === 'research' && parts[2]) { fn = detail; args = ['research', parts[2]]; }
    else if (seg === 'research') fn = () => listPage('research');
    else if (seg === 'homestays') fn = () => listPage('homestay');
    else if (seg === 'shop') fn = () => listPage('product');
    else if (seg === 'orchard') { fn = detail; args = ['orchard', parts[2]]; }
    else if (seg === 'homestay') { fn = detail; args = ['homestay', parts[2]]; }
    else if (seg === 'product') { fn = detail; args = ['product', parts[2]]; }
    else if (seg === 'cart') fn = cart;
    else if (seg === 'checkout') fn = checkout;
    else if (seg === 'mine') fn = mine;
    else if (seg === 'festivals') fn = festivals;
    else if (seg === 'checkin') fn = checkinPage;
    else if (seg === 'login') fn = login;
    else fn = home;

    if (['cart', 'checkout', 'mine'].indexOf(seg) >= 0 && !needLogin()) return;
    current = () => fn.apply(null, args);
    app.innerHTML = PC.loading();
    try { await current(); }
    catch (e) {
      if (e && (e.code === 401 || e.code === 403)) { Router.go('/login'); return; }
      renderError(e);
    }
    window.scrollTo(0, 0);
  });
})();
