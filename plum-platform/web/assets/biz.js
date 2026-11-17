/* 商户 PC 工作台：概览、场次、房态、商品、订单发货、统一核销。
   全部复用现有 /api/merchant 接口，表格 + 居中弹层表单，权限由后端 require_login 兜底。 */
(function () {
  'use strict';

  const E = UI.esc;
  const app = document.getElementById('app');
  const PAGES = {
    '/home': '工作台', '/sessions': '采摘场次', '/rooms': '房态与房价',
    '/products': '商品管理', '/orders': '订单与发货', '/checkin': '统一核销', '/login': '登录',
  };
  const state = { merchantId: null, page: 1, size: 20, orderStatus: '', productKw: '', productRows: [] };
  let current = null;

  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function dayAfter(days) {
    const d = new Date(Date.now() + days * 86400000);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function money(v) { return '¥' + E(v == null ? '' : v); }
  function render(html) { app.innerHTML = html; }
  function head(title, right) {
    return `<div class="pc-section-title" style="margin-top:0"><h2>${E(title)}</h2>${right || ''}</div>`;
  }
  function crumb(text) {
    return PC.crumb([{ text: '工作台', href: '#/home' }, { text }]);
  }
  function renderError(e) {
    render(PC.error(e && e.message ? e.message : '这页没打开'));
    PC.bindRetry(app, reload);
  }
  function reload() {
    if (current) return Promise.resolve().then(current).catch(renderError);
    return Promise.resolve();
  }

  // ---------- 顶栏 / 导航 ----------
  function syncTop() {
    const u = Session.user();
    document.getElementById('whoami').textContent = u ? u.nickname + ' · ' + u.role : '还没登录';
    const out = document.getElementById('logoutBtn');
    out.style.display = u ? '' : 'none';
    out.onclick = () => PC.confirm('要退出工作台吗？其它端的登录不受影响。', () => {
      API.post('/api/auth/logout').catch(() => {});
      Session.clear(); location.reload();
    }, '退出');
  }

  function syncNav(path) {
    const key = path.split('/')[1] || 'home';
    document.querySelectorAll('.pc-sidebar .pc-nav a').forEach((a) =>
      a.classList.toggle('on', a.dataset.nav === key));
    document.getElementById('pageTitle').textContent = PAGES[path] || PAGES['/' + key] || '工作台';
    document.getElementById('shell').classList.remove('nav-open');
  }

  document.getElementById('hamburger').onclick = () =>
    document.getElementById('shell').classList.toggle('nav-open');

  // ---------- 通用弹层表单 ----------
  function editDialog(title, fields, values, onSubmit) {
    return PC.modal(title, PC.form(fields, values) +
      `<div class="pc-form-actions">
        <button class="btn" data-close>算了</button>
        <button class="btn btn-primary" id="saveBtn">保存</button></div>`,
      (el, close) => {
        const save = async () => {
          if (!PC.validate(el, fields)) return;
          const v = PC.readForm(el, fields);
          const btn = el.querySelector('#saveBtn');
          btn.disabled = true;
          try { await onSubmit(v); close(); }
          catch (e) { UI.toast(e.message || '没存上'); btn.disabled = false; }
        };
        el.querySelector('#saveBtn').onclick = save;
        PC.onEnter(el.querySelector('.pc-form'), save);
      });
  }

  function selectOptions(list, textKey, valueKey) {
    return (list || []).map((x) => ({ value: x[valueKey || 'id'], text: x[textKey || 'name'] }));
  }

  // ---------- 工作台 ----------
  async function home() {
    const [ov, sessions, bookings] = await Promise.all([
      API.get('/api/merchant/overview'),
      API.get('/api/merchant/sessions').catch(() => []),
      API.get('/api/merchant/bookings').catch(() => []),
    ]);
    state.merchantId = ov.merchant_id;
    document.getElementById('merchantTag').textContent = ov.merchant_id
      ? '经营主体 #' + ov.merchant_id : '管理员 · 全量数据';
    const sessionCols = [
      { title: '日期', key: 'session_date' }, { title: '时段', key: 'slot' },
      { title: '园子', key: 'orchard_name' },
      { title: '容量 / 已约', key: 'capacity', render: (r) => `${E(r.capacity)} / ${E(r.booked)}` },
      { title: '审核', key: 'audit_status', render: (r) => UI.badge(r.audit_status) },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
    ];
    const bookingCols = [
      { title: '类型', key: 'type_label' }, { title: '单号', key: 'code' },
      { title: '核销码', key: 'checkin_code', render: (r) => `<b>${E(r.checkin_code)}</b>` },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
      { title: '时间', key: 'created_at' },
    ];
    render(crumb('工作台') + head('今天怎么样', `<a class="btn btn-sm btn-primary" href="#/checkin">去核销 →</a>`) +
      PC.stat([
        { label: '今日订单', value: ov.today_orders || 0 },
        { label: '待核销', value: ov.pending_checkin || 0 },
        { label: '在售商品', value: ov.on_sale || 0 },
        { label: '今日预约', value: ov.today_bookings || 0 },
      ]) +
      `<div class="pc-section-title"><h2>最近的场次</h2><a class="more" href="#/sessions">全部场次 →</a></div>` +
      PC.table(sessionCols, (sessions || []).slice(0, 6), { empty: '还没排场次' }) +
      `<div class="pc-section-title"><h2>待办核销</h2><a class="more" href="#/checkin">去核销 →</a></div>` +
      PC.table(bookingCols, (bookings || []).slice(0, 6), { empty: '眼下没有待核销的单子' }));
  }

  // ---------- 采摘场次 ----------
  async function sessions() {
    const [list, orchards] = await Promise.all([
      API.get('/api/merchant/sessions'),
      API.get('/api/orchards?pageSize=100').then((d) => d.records || []).catch(() => []),
    ]);
    const rows = list || [];
    const cols = [
      { title: '日期', key: 'session_date' }, { title: '时段', key: 'slot' },
      { title: '园子', key: 'orchard_name', render: (r) => E(r.orchard_name || '—') },
      { title: '容量', key: 'capacity', align: 'right' },
      { title: '已约', key: 'booked', align: 'right' },
      { title: '余位', key: 'id', align: 'right', render: (r) =>
        E(Math.max(0, (r.capacity || 0) - (r.booked || 0))) },
      { title: '审核', key: 'audit_status', render: (r) => UI.badge(r.audit_status) },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
      { title: '操作', key: 'id', width: '110px', render: (r) =>
        `<button class="btn btn-sm" data-edit="${E(r.id)}">改容量</button>` },
    ];
    render(crumb('采摘场次') + head('采摘场次',
      `<button class="btn btn-sm btn-primary" id="newSession">新增场次</button>`) +
      `<div class="pc-hint">共 ${rows.length} 场</div>` +
      PC.table(cols, rows, { empty: '还没排场次，点右上角新增' }));

    app.querySelector('#newSession').onclick = () => {
      const fields = [
        { name: 'orchard_id', label: '园子', type: 'select', required: true,
          options: selectOptions(orchards, 'name', 'id') },
        { name: 'session_date', label: '日期', type: 'date', required: true, value: dayAfter(1) },
        { name: 'slot', label: '时段', required: true, value: '上午 09:00-11:30' },
        { name: 'capacity', label: '容量（1-500）', type: 'number', required: true, value: 40, min: 1, max: 500 },
      ];
      editDialog('新增采摘场次', fields, {}, async (v) => {
        const r = await API.post('/api/merchant/sessions', {
          orchard_id: Number(v.orchard_id), session_date: v.session_date,
          slot: v.slot, capacity: Number(v.capacity),
        });
        UI.toast(r.tip || '场次已提交'); await reload();
      });
    };
    app.querySelectorAll('[data-edit]').forEach((b) => {
      const row = rows.filter((r) => String(r.id) === b.dataset.edit)[0] || {};
      b.onclick = () => {
        const fields = [
          { name: 'capacity', label: '容量', type: 'number', required: true, value: row.capacity, min: row.booked, max: 500 },
          { name: 'status', label: '状态', type: 'select', required: true, value: row.status,
            options: ['可预约', '已满', '停办'].map((s) => ({ value: s, text: s })) },
        ];
        editDialog('改这一场', fields, {}, async (v) => {
          await API.put('/api/merchant/sessions/' + row.id, {
            capacity: Number(v.capacity), status: v.status,
          });
          UI.toast('改好了'); await reload();
        });
      };
    });
  }

  // ---------- 房态与房价 ----------
  async function rooms() {
    const [list, homestays] = await Promise.all([
      API.get('/api/merchant/rooms'),
      API.get('/api/homestays').catch(() => []),
    ]);
    const rows = list || [];
    const cols = [
      { title: '房型', key: 'name' },
      { title: '民宿', key: 'homestay_name', render: (r) => E(r.homestay_name || '—') },
      { title: '可住人数', key: 'capacity', align: 'right' },
      { title: '价格 / 晚', key: 'price', align: 'right', render: (r) => `<span class="price">${money(r.price)}</span>` },
      { title: '余房', key: 'stock', align: 'right' },
      { title: '操作', key: 'id', width: '110px', render: (r) =>
        `<button class="btn btn-sm" data-edit="${E(r.id)}">改价 / 改房态</button>` },
    ];
    render(crumb('房态与房价') + head('房态与房价',
      `<button class="btn btn-sm btn-primary" id="newRoom">新增房型</button>`) +
      `<div class="pc-hint">共 ${rows.length} 个房型</div>` +
      PC.table(cols, rows, { empty: '还没有房型' }));

    app.querySelector('#newRoom').onclick = () => {
      const fields = [
        { name: 'homestay_id', label: '民宿', type: 'select', required: true,
          options: selectOptions(homestays, 'name', 'id') },
        { name: 'name', label: '房型名', required: true },
        { name: 'price', label: '价格（元 / 晚）', type: 'number', required: true, value: 280, min: 1, step: '0.01' },
        { name: 'capacity', label: '可住人数', type: 'number', required: true, value: 2, min: 1, max: 10 },
        { name: 'stock', label: '余房', type: 'number', required: true, value: 2, min: 0, max: 99 },
      ];
      editDialog('新增房型', fields, {}, async (v) => {
        await API.post('/api/merchant/rooms', {
          homestay_id: Number(v.homestay_id), name: v.name, price: v.price,
          capacity: Number(v.capacity), stock: Number(v.stock),
        });
        UI.toast('房型加好了'); await reload();
      });
    };
    app.querySelectorAll('[data-edit]').forEach((b) => {
      const row = rows.filter((r) => String(r.id) === b.dataset.edit)[0] || {};
      b.onclick = () => {
        const fields = [
          { name: 'name', label: '房型名', required: true, value: row.name },
          { name: 'price', label: '价格（元 / 晚）', type: 'number', required: true, value: row.price, min: 1, step: '0.01' },
          { name: 'stock', label: '余房', type: 'number', required: true, value: row.stock, min: 0, max: 99 },
        ];
        editDialog('改房型', fields, {}, async (v) => {
          await API.put('/api/merchant/rooms/' + row.id, {
            name: v.name, price: v.price, stock: Number(v.stock),
          });
          UI.toast('改好了'); await reload();
        });
      };
    });
  }

  // ---------- 商品管理 ----------
  async function products() {
    const [d, cats] = await Promise.all([
      API.get('/api/merchant/products' + PC.qs({ pageNum: state.page, pageSize: state.size })),
      API.get('/api/categories').catch(() => []),
    ]);
    let rows = d.records || [];
    if (state.productKw) {
      rows = rows.filter((r) => (String(r.name || '') + String(r.subtitle || '')).indexOf(state.productKw) >= 0);
    }
    state.productRows = rows;
    const cols = [
      { title: '', key: 'id', width: '40px', render: (r) =>
        `<input type="checkbox" data-check="${E(r.id)}" aria-label="选择 ${E(r.name)}" />` },
      { title: '商品', key: 'name', render: (r) => `<div style="display:flex;gap:10px;align-items:center">
        ${UI.img(r.image, 'img-1-1', 'style="width:42px;height:42px;flex:0 0 42px"')}
        <div><div class="strong clip">${E(r.name)}</div>
        <div class="small muted clip">${E(r.subtitle || '')}</div></div></div>` },
      { title: '分类', key: 'category_name', render: (r) => E(r.category_name || '—') },
      { title: '价格', key: 'price', align: 'right', render: (r) => `<span class="price">${money(r.price)}</span>` },
      { title: '库存', key: 'stock', align: 'right' },
      { title: '销量', key: 'sales', align: 'right' },
      { title: '审核', key: 'audit_status', render: (r) => UI.badge(r.audit_status) },
      { title: '上架', key: 'shelf_status', render: (r) => UI.badge(r.shelf_status) },
      { title: '操作', key: 'id', width: '170px', render: (r) => `<div class="row-actions">
        <button class="btn btn-sm" data-edit="${E(r.id)}">编辑</button>
        <button class="btn btn-sm" data-shelf="${E(r.id)}">${r.shelf_status === '上架' ? '下架' : '上架'}</button>
        </div>` },
    ];
    const toolbar = `<div class="pc-toolbar batch-bar">
      <input class="input grow" id="pkw" value="${E(state.productKw)}" placeholder="本页搜商品名…" aria-label="搜索商品" />
      <button class="btn" id="psearch">筛选</button>
      <button class="btn" id="preset">重置</button>
      <span class="spacer"></span>
      <button class="btn btn-sm" id="batchOn">批量上架</button>
      <button class="btn btn-sm" id="batchOff">批量下架</button>
      <button class="btn btn-sm btn-primary" id="newProduct">新增商品</button>
    </div>`;
    render(crumb('商品管理') + head('商品管理') + toolbar +
      `<div class="pc-hint">共 ${E(d.total || 0)} 件</div>` +
      PC.table(cols, rows, { empty: '没有符合条件的商品' }) +
      PC.pager(d.current || state.page, d.size || state.size, d.total || 0));

    const doFilter = () => {
      state.productKw = app.querySelector('#pkw').value.trim();
      reload();
    };
    app.querySelector('#psearch').onclick = doFilter;
    PC.onEnter(app.querySelector('#pkw'), doFilter);
    app.querySelector('#preset').onclick = () => { state.productKw = ''; reload(); };
    PC.bindPager(app, (p) => { state.page = p; reload(); });

    app.querySelector('#newProduct').onclick = () => newProductDialog(cats);
    app.querySelectorAll('[data-edit]').forEach((b) => {
      const row = rows.filter((r) => String(r.id) === b.dataset.edit)[0] || {};
      b.onclick = () => editDialog('编辑商品', [
        { name: 'name', label: '商品名', required: true, value: row.name },
        { name: 'price', label: '价格（元）', type: 'number', required: true, value: row.price, min: 0.01, step: '0.01' },
        { name: 'stock', label: '库存', type: 'number', required: true, value: row.stock, min: 0 },
      ], {}, async (v) => {
        await API.put('/api/merchant/products/' + row.id, {
          name: v.name, price: v.price, stock: Number(v.stock),
        });
        UI.toast('改好了'); await reload();
      });
    });
    app.querySelectorAll('[data-shelf]').forEach((b) => {
      b.onclick = async () => {
        try {
          await API.put('/api/merchant/products/' + b.dataset.shelf, { action: 'shelf' });
          UI.toast('状态改好了'); await reload();
        } catch (e) { UI.toast(e.message); }
      };
    });
    app.querySelector('#batchOn').onclick = () => batchShelf('上架');
    app.querySelector('#batchOff').onclick = () => batchShelf('下架');
  }

  function checkedIds() {
    return Array.prototype.slice.call(app.querySelectorAll('[data-check]:checked'))
      .map((el) => el.dataset.check);
  }

  async function batchShelf(target) {
    const ids = checkedIds();
    if (!ids.length) { UI.toast('先在左边勾几件商品'); return; }
    const todos = ids.filter((id) => {
      const r = state.productRows.filter((x) => String(x.id) === id)[0];
      return r && r.shelf_status !== target && r.audit_status === '已通过';
    });
    if (!todos.length) { UI.toast('勾中的没有需要改状态的（或还没审核通过）'); return; }
    PC.confirm('把选中的 ' + todos.length + ' 件商品改成「' + target + '」？', async () => {
      try {
        await Promise.all(todos.map((id) =>
          API.put('/api/merchant/products/' + id, { action: 'shelf' })));
        UI.toast('改好了 ' + todos.length + ' 件'); await reload();
      } catch (e) { UI.toast(e.message || '有商品没改成'); await reload(); }
    }, '确认');
  }

  function newProductDialog(cats) {
    const fields = [
      { name: 'name', label: '商品名', required: true },
      { name: 'subtitle', label: '副标题', value: '自家做的，卖完等下一季' },
      { name: 'category_id', label: '分类', type: 'select', required: true,
        options: selectOptions(cats, 'name', 'id') },
      { name: 'price', label: '价格（元）', type: 'number', required: true, value: 39.9, min: 0.01, step: '0.01' },
      { name: 'stock', label: '库存', type: 'number', required: true, value: 20, min: 0 },
      { name: 'intro', label: '介绍', type: 'textarea', value: '选的是本地青梅，做法还是老一辈传下来的。' },
    ];
    editDialog('新增商品', fields, {}, async (v) => {
      const r = await API.post('/api/merchant/products', {
        name: v.name, subtitle: v.subtitle, category_id: Number(v.category_id),
        price: v.price, stock: Number(v.stock), intro: v.intro,
      });
      UI.toast(r.tip || '商品已提交'); await reload();
    });
  }

  // ---------- 订单与发货 ----------
  async function orders() {
    const d = await API.get('/api/merchant/orders' + PC.qs({
      pageNum: state.page, pageSize: state.size, status: state.orderStatus,
    }));
    const rows = d.records || [];
    const cols = [
      { title: '单号', key: 'order_no' },
      { title: '收货人', key: 'receiver', render: (r) => `${E(r.receiver)}<div class="small muted">${E(r.phone || '')}</div>` },
      { title: '商品', key: 'items', render: (r) => (r.items || []).map((i) =>
        `${E(i.name)} × ${E(i.quantity)}`).join('、') || '<span class="muted small">—</span>' },
      { title: '金额', key: 'amount', align: 'right', render: (r) => `<span class="price">${money(r.amount)}</span>` },
      { title: '下单时间', key: 'created_at' },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
      { title: '操作', key: 'id', width: '100px', render: (r) => r.status === '已支付'
        ? `<button class="btn btn-sm btn-primary" data-ship="${E(r.id)}">发货</button>`
        : '<span class="muted small">—</span>' },
    ];
    const statuses = ['', '待支付', '已支付', '已发货', '已完成', '已取消'];
    const toolbar = `<div class="pc-toolbar">
      <select class="select" id="ostatus" aria-label="订单状态">${statuses.map((s) =>
        `<option value="${E(s)}" ${s === state.orderStatus ? 'selected' : ''}>${E(s || '全部状态')}</option>`).join('')}</select>
      <span class="spacer"></span><span class="small muted">共 ${E(d.total || 0)} 笔</span></div>`;
    render(crumb('订单与发货') + head('订单与发货') + toolbar +
      PC.table(cols, rows, { empty: '这个状态下还没有订单' }) +
      PC.pager(d.current || state.page, d.size || state.size, d.total || 0));
    app.querySelector('#ostatus').onchange = (e) => {
      state.orderStatus = e.target.value; state.page = 1; reload();
    };
    PC.bindPager(app, (p) => { state.page = p; reload(); });
    app.querySelectorAll('[data-ship]').forEach((b) => {
      b.onclick = () => PC.confirm('确认已经交给快递了吗？发货后状态就不能回退了。', async () => {
        try { await API.post('/api/merchant/orders/' + b.dataset.ship + '/ship', {});
          UI.toast('发货了'); await reload(); }
        catch (e) { UI.toast(e.message); }
      }, '确认发货');
    });
  }

  // ---------- 统一核销 ----------
  async function checkinPage() {
    const list = await API.get('/api/merchant/bookings');
    const cols = [
      { title: '类型', key: 'type_label' }, { title: '单号', key: 'code' },
      { title: '核销码', key: 'checkin_code', render: (r) => `<b>${E(r.checkin_code)}</b>` },
      { title: '状态', key: 'status', render: (r) => UI.badge(r.status) },
      { title: '时间', key: 'created_at' },
      { title: '操作', key: 'checkin_code', width: '100px', render: (r) =>
        `<button class="btn btn-sm" data-fill="${E(r.checkin_code)}">填入</button>` },
    ];
    render(crumb('统一核销') + head('统一核销') +
      `<div class="card" style="max-width:720px">
        <h3 class="card-title">输入或扫描核销码</h3>
        <input class="input checkin-input" id="code" placeholder="CK..." autocomplete="off" aria-label="核销码" />
        <div class="pc-form-actions"><button class="btn btn-primary" id="doCheckin">核销</button></div>
        <div id="checkinResult"></div>
      </div>
      <div class="pc-section-title"><h2>待办核销</h2><span class="more">${(list || []).length} 条</span></div>` +
      PC.table(cols, list || [], { empty: '眼下没有待核销的单子' }));

    const input = app.querySelector('#code');
    const result = app.querySelector('#checkinResult');
    const submit = async () => {
      const code = input.value.trim();
      if (!code) { UI.toast('先填一个核销码'); return; }
      try {
        const r = await API.post('/api/merchant/checkin', { checkin_code: code });
        result.innerHTML = `<div class="checkin-result ok"><b>核销成功</b>
          <div class="small">${E(r.code || code)} · ${E(r.status || '已核销')}</div></div>`;
        input.value = '';
        UI.toast('核销好了');
        setTimeout(() => reload(), 600);
      } catch (e) {
        result.innerHTML = `<div class="checkin-result bad"><b>没核销成</b>
          <div class="small">${E(e.message)}</div></div>`;
      }
    };
    app.querySelector('#doCheckin').onclick = submit;
    PC.onEnter(input, submit);
    app.querySelectorAll('[data-fill]').forEach((b) => {
      b.onclick = () => { input.value = b.dataset.fill; input.focus(); };
    });
    input.focus();
  }

  // ---------- 登录 ----------
  function login() {
    const fields = [
      { name: 'username', label: '账号', required: true, value: 'farmer01' },
      { name: 'password', label: '口令', type: 'password', required: true, value: 'merchant123' },
    ];
    render(crumb('登录') + `<div class="card" style="max-width:520px;margin:28px auto">
      <h2 style="font-size:20px">登录商户工作台</h2>
      ${PC.form(fields)}
      <div class="pc-form-actions"><button class="btn btn-primary" id="doLogin">进工作台</button></div>
    </div>`);
    const btn = app.querySelector('#doLogin');
    const submit = async () => {
      if (!PC.validate(app, fields)) return;
      const v = PC.readForm(app, fields);
      btn.disabled = true;
      try {
        const d = await API.post('/api/auth/login', {
          username: v.username, password: v.password, role: '商户',
        });
        if (d.role !== '商户' && d.role !== '管理员') throw new Error('这个账号不是商户');
        Session.set(d.sessionId, { nickname: d.nickname, role: d.role });
        UI.toast('进来啦，' + d.nickname);
        location.reload();
      } catch (e) { UI.toast(e.message || '没登上去'); }
      finally { btn.disabled = false; }
    };
    btn.onclick = submit;
    PC.onEnter(app.querySelector('.pc-form'), submit);
  }

  // ---------- 路由 ----------
  PC.syncGuardEvent('/login');
  Router.on(async (path) => {
    syncTop(); syncNav(path);
    const key = path.split('/')[1] || 'home';
    const map = {
      home, sessions, rooms, products, orders,
      checkin: checkinPage, login,
    };
    const fn = map[key] || home;
    if (key !== 'login' && !PC.guard(['商户', '管理员'], '/login')) return;
    current = fn;
    app.innerHTML = PC.loading();
    try { await fn(); }
    catch (e) {
      if (e && (e.code === 401 || e.code === 403)) { Router.go('/login'); return; }
      renderError(e);
    }
    window.scrollTo(0, 0);
  });
})();
