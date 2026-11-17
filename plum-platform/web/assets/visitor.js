/* 游客端：小程序同源页面。文案按镇上人说话的习惯写，短句、具体、不端着。 */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const E = UI.esc;
  let carouselTimer = null;
  let currentTab = 'ai-chat';

  window.addEventListener('plum:unauthorized', (e) => {
    UI.toast(e.detail || '登录状态变了，重新登一下');
    Router.go('/login');
  });

  const rid = () => 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const yuan = (v) => `<span class="price">¥${E(v)}</span>`;
  const needLogin = () => {
    if (Session.id()) return true;
    UI.toast('先登录一下，马上就好'); Router.go('/login'); return false;
  };

  function setTop(sub) { document.getElementById('topSub').textContent = sub || '大邑䢺江镇 · 慢慢逛'; }
  function syncAccount() {
    const u = Session.user();
    const btn = document.getElementById('accountBtn');
    btn.textContent = u ? u.nickname : '登录';
    btn.onclick = () => {
      if (!u) return Router.go('/login');
      UI.confirm('要退出登录吗？', () => { API.post('/api/auth/logout').catch(() => {});
        Session.clear(); UI.toast('回见，常来'); location.reload(); });
    };
  }
  function syncTab(path) {
    const key = path.split('/')[1] || 'home';
    const map = { orchard: 'home', orchards: 'home', research: 'home', homestay: 'home',
      homestays: 'home', festivals: 'home', product: 'shop', cart: 'shop' };
    const tab = map[key] || key;
    document.querySelectorAll('.tabbar a').forEach((a) =>
      a.classList.toggle('on', a.dataset.tab === tab));
  }

  /* ---------- 地图：与小程序共用同一张离线底图、同一套点位锚点 ---------- */
  function mapSVG(spots, onClick) {
    if (!spots.length) return UI.empty('园子还没标到图上');
    if (!window.PlumMap) return UI.empty('地图组件没加载，检查 /web/map.js');
    const html = PlumMap.html(spots);
    setTimeout(() => PlumMap.bind(document, spots, onClick), 0);
    return html;
  }

  /* ---------- 首页 ---------- */
  async function home() {
    setTop('梅子熟的时候，来镇上坐坐');
    const d = await API.get('/api/home');
    const banners = d.banners || [];
    let bi = 0;
    clearInterval(carouselTimer);
    app.innerHTML = `
      <div class="hero">${UI.img(banners[0], 'img-16-9', 'id="heroImg"')}
        <div class="hero-text"><h2 id="heroTitle">青梅熟了，上山走走</h2>
          <p id="heroSub">${E(d.season_tip ? d.season_tip.title : '这个时节正好')}</p></div></div>
      <div class="grid grid-4" style="margin-top:12px;text-align:center">
        <a class="card card-flat" href="#/orchards"><div class="small">采摘预约</div></a>
        <a class="card card-flat" href="#/research"><div class="small">酿酒研学</div></a>
        <a class="card card-flat" href="#/homestays"><div class="small">住一晚</div></a>
        <a class="card card-flat" href="#/festivals"><div class="small">赶节庆</div></a>
      </div>
      <div class="card" style="margin-top:12px;background:var(--gold-soft);border-color:#efdfb8">
        <div class="small" style="color:#96691a">这一季 · ${E(d.season_tip ? d.season_tip.month_range : '')}
          ${E(d.season_tip ? d.season_tip.title : '')}</div>
        <div style="margin-top:4px">${E(d.season_tip ? d.season_tip.content : '')}</div>
      </div>
      <div class="section-head"><h3>青梅园地图</h3><a class="more" href="#/orchards">看全部园子 ›</a></div>
      <div class="map-box" id="homeMap"></div>
      <div class="section-head"><h3>镇上的节庆</h3></div>
      <div class="grid grid-2">${(d.festivals || []).slice(0, 4).map((f) => `
        <div class="card" style="padding:0;overflow:hidden">${UI.img(f.image, 'img-16-9')}
          <div style="padding:10px"><b class="small">${E(f.title)}</b>
            <div class="small muted">${E(f.festival_date)} · ${E(f.place)}</div></div></div>`).join('')}</div>
      <div class="section-head"><h3>跟着老师傅学酿酒</h3><a class="more" href="#/research">更多 ›</a></div>
      ${(d.research || []).map((r) => `<a class="list-item" href="#/research/${r.id}">
        ${UI.img(r.image, 'img-1-1')}<div class="body"><h4>${E(r.title)}</h4>
        <div class="small muted">${E(r.start_date)} · 已报 ${r.signed}/${r.capacity} 人</div>
        <div>${yuan(r.price)}<span class="small muted"> /人</span></div></div></a>`).join('')}
      <div class="section-head"><h3>带点回去</h3><a class="more" href="#/shop">逛商城 ›</a></div>
      <div class="grid grid-2">${(d.products || []).map((p) => `
        <a class="card" style="padding:0;overflow:hidden" href="#/product/${p.id}">
          ${UI.img(p.image, 'img-1-1')}<div style="padding:10px">
          <div class="small ellipsis"><b>${E(p.name)}</b></div>
          <div class="small muted ellipsis">${E(p.subtitle)}</div>
          <div>${yuan(p.price)} <span class="small muted">已售 ${p.sales}</span></div></div></a>`).join('')}</div>
      <a class="card" style="display:block;margin-top:16px;background:var(--green-soft)" href="#/ai">
        <b>有不明白的，问问小梅</b></a>`;
    const spots = d.orchards || [];
    document.getElementById('homeMap').innerHTML = mapSVG(spots, (s) => {
      UI.sheet(s.name, `<p class="small muted">${E(s.address)}</p>
        <p>大人 ${E(s.price || s.adult_price)} 元起，${E(s.town)}的园子。</p>
        <a class="btn btn-primary btn-block" href="#/orchard/${s.id}">看看这个园子</a>`);
    });
    if (banners.length > 1) {
      carouselTimer = setInterval(() => {
        bi = (bi + 1) % banners.length;
        const img = document.getElementById('heroImg');
        if (img) img.src = banners[bi]; else clearInterval(carouselTimer);
      }, 4000);
    }
  }

  /* ---------- 采摘园 ---------- */
  async function orchardList() {
    setTop('挑个园子，摘一篮回来');
    const d = await API.get('/api/orchards?pageSize=50');
    app.innerHTML = `<div class="field"><input class="input" id="kw" placeholder="搜园子名、地址" /></div>
      <div id="list"></div>`;
    const draw = (items) => {
      document.getElementById('list').innerHTML = items.length ? items.map((o) => `
        <a class="list-item" href="#/orchard/${o.id}">${UI.img(o.image, 'img-1-1')}
          <div class="body"><h4>${E(o.name)}</h4>
          <div class="small muted ellipsis">${E(o.address)}</div>
          <div class="small muted">${E(o.open_time)} · ${E(o.town)}</div>
          <div>${yuan(o.adult_price)}<span class="small muted"> /大人，含两斤带走</span></div></div></a>`).join('')
        : UI.empty('没找着，换个词试试');
    };
    draw(d.records);
    document.getElementById('kw').oninput = async (e) => {
      const r = await API.get('/api/orchards?pageSize=50&keyword=' + encodeURIComponent(e.target.value));
      draw(r.records);
    };
  }

  async function orchardDetail(id) {
    const d = await API.get('/api/orchards/' + id);
    setTop(d.name);
    app.innerHTML = `${UI.img(d.image, 'img-16-9')}
      <div class="card" style="margin-top:12px"><h3>${E(d.name)}</h3>
        <div class="small muted" style="margin:6px 0">${E(d.address)} · ${E(d.open_time)}</div>
        <p class="small">${E(d.intro)}</p>
        <div style="margin-top:8px">大人 ${yuan(d.adult_price)}　小朋友 ${yuan(d.child_price)}
          <span class="small muted">门票含两斤梅子带走</span></div>
        <button class="btn btn-block" style="margin-top:10px" id="playBtn">听一段讲解</button>
        <div id="ttsText" class="small muted" style="margin-top:8px"></div>
      </div>
      <div class="section-head"><h3>挑个场次</h3></div>
      <div id="sessions">${(d.sessions || []).length ? d.sessions.map((s) => `
        <div class="card" style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between">
          <div><b>${E(s.date)}</b><div class="small muted">${E(s.slot)} · 还剩 ${s.left} 个位置</div></div>
          <button class="btn btn-primary btn-sm" data-session="${s.id}" data-left="${s.left}"
            ${s.left < 1 ? 'disabled' : ''}>约这场</button></div>`).join('') : UI.empty('这几天的场次排满了，过两天再来看看')}</div>`;
    document.getElementById('playBtn').onclick = async () => {
      const r = await API.post('/api/ai/tts', { target_id: id, target_type: 'orchard' });
      document.getElementById('ttsText').textContent = r.text;
      if ('speechSynthesis' in window) {
        speechSynthesis.cancel();
        r.segments.forEach((s) => { const u = new SpeechSynthesisUtterance(s);
          u.lang = 'zh-CN'; u.rate = .95; speechSynthesis.speak(u); });
        UI.toast('开始念了，再点一下可以停');
        document.getElementById('playBtn').onclick = () => { speechSynthesis.cancel(); UI.toast('停下了'); orchardDetail(id); };
      } else UI.toast('这个浏览器念不了，看文字吧');
    };
    document.querySelectorAll('[data-session]').forEach((b) => {
      b.onclick = () => {
        if (!needLogin()) return;
        UI.sheet('约一场采摘', `<div class="field"><label>几个人来</label>
            <input class="input" id="ppl" type="number" value="2" min="1" max="20" /></div>
          <div class="form-row"><div class="field"><label>联系人</label><input class="input" id="contact" value="小梅" /></div>
          <div class="field"><label>手机号</label><input class="input" id="phone" value="13700000001" /></div></div>
          <button class="btn btn-primary btn-block" id="doBook">就这么约了</button>`, (m) => {
          m.querySelector('#doBook').onclick = async () => {
            try {
              const r = await API.post('/api/reservations', {
                session_id: Number(b.dataset.session), people: Number(m.querySelector('#ppl').value),
                contact: m.querySelector('#contact').value, phone: m.querySelector('#phone').value,
                requestId: rid(),
              });
              m.remove();
              UI.sheet('约好啦', `<p>${E(r.tip)}</p>
                <div class="card" style="text-align:center;background:var(--green-soft)">
                  <div class="small muted">到场给园主看这个码</div>
                  <div style="font-size:22px;letter-spacing:2px;font-weight:700">${E(r.checkin_code)}</div></div>
                <a class="btn btn-primary btn-block" href="#/mine" style="margin-top:12px">去「我的」看看</a>`);
            } catch (e) { UI.toast(e.message); }
          };
        });
      };
    });
  }

  /* ---------- 研学 / 民宿 ---------- */
  async function researchList() {
    setTop('跟着老师傅，封一罐自己的酒');
    const d = await API.get('/api/research');
    app.innerHTML = d.map((r) => `<a class="list-item" href="#/research/${r.id}">
      ${UI.img(r.image, 'img-1-1')}<div class="body"><h4>${E(r.title)}</h4>
      <div class="small muted">${E(r.start_date)} · 已报 ${r.signed}/${r.capacity} 人</div>
      <div class="small muted ellipsis">${E(r.intro)}</div>
      <div>${yuan(r.price)}<span class="small muted"> /人</span></div></div></a>`).join('');
  }

  async function researchDetail(id) {
    const d = await API.get('/api/research/' + id);
    setTop(d.title);
    app.innerHTML = `${UI.img(d.image, 'img-16-9')}
      <div class="card" style="margin-top:12px"><h3>${E(d.title)}</h3>
        <p class="small" style="margin-top:6px">${E(d.intro)}</p>
        <div class="small muted">${E(d.start_date)} 开课 · 已报 ${d.signed}/${d.capacity} 人</div>
        <div style="margin-top:8px">${yuan(d.price)} <span class="small muted">/人</span></div>
        <button class="btn btn-primary btn-block" style="margin-top:10px" id="signup">报个名</button></div>`;
    document.getElementById('signup').onclick = () => {
      if (!needLogin()) return;
      UI.sheet('报个名', `<div class="field"><label>几个人</label><input class="input" id="ppl" type="number" value="2" min="1" /></div>
        <div class="form-row"><div class="field"><label>联系人</label><input class="input" id="contact" value="小梅" /></div>
        <div class="field"><label>手机号</label><input class="input" id="phone" value="13700000001" /></div></div>
        <button class="btn btn-primary btn-block" id="go">报上</button>`, (m) => {
        m.querySelector('#go').onclick = async () => {
          try {
            const r = await API.post('/api/research/signup', { research_id: Number(id),
              people: Number(m.querySelector('#ppl').value), contact: m.querySelector('#contact').value,
              phone: m.querySelector('#phone').value, requestId: rid() });
            m.remove(); UI.sheet('报上啦', `<p>核销码 <b>${E(r.checkin_code)}</b>，到场给师傅看一眼就行。</p>`);
          } catch (e) { UI.toast(e.message); }
        };
      });
    };
  }

  async function homestayList() {
    setTop('住一晚，早上推窗就是梅园');
    const d = await API.get('/api/homestays');
    app.innerHTML = d.map((h) => `<a class="list-item" href="#/homestay/${h.id}">
      ${UI.img(h.image, 'img-1-1')}<div class="body"><h4>${E(h.name)}</h4>
      <div class="small muted ellipsis">${E(h.address)}</div>
      <div class="small muted">${E(h.intro)}</div></div></a>`).join('');
  }

  async function homestayDetail(id) {
    const d = await API.get('/api/homestays/' + id);
    setTop(d.name);
    const today = new Date(), d2 = new Date(today.getTime() + 86400000 * 2),
      d3 = new Date(today.getTime() + 86400000 * 3);
    const iso = (x) => x.toISOString().slice(0, 10);
    app.innerHTML = `${UI.img(d.image, 'img-16-9')}
      <div class="card" style="margin-top:12px"><h3>${E(d.name)}</h3>
        <p class="small muted">${E(d.intro)}</p>
        <div class="form-row" style="margin-top:10px">
          <div class="field"><label>入住</label><input class="input" type="date" id="ci" value="${iso(d2)}" /></div>
          <div class="field"><label>退房</label><input class="input" type="date" id="co" value="${iso(d3)}" /></div></div>
        <div class="field"><label>几个人住</label><input class="input" type="number" id="guests" value="2" min="1" /></div>
      </div>
      <div class="section-head"><h3>挑个房</h3></div>
      ${d.rooms.map((r) => `<div class="card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
        <div><b>${E(r.name)}</b><div class="small muted">可住 ${r.capacity} 人 · 还有 ${r.stock} 间</div>
        <div>${yuan(r.price)} <span class="small muted">/晚</span></div></div>
        <button class="btn btn-primary btn-sm" data-room="${r.id}">订这间</button></div>`).join('')}`;
    document.querySelectorAll('[data-room]').forEach((b) => {
      b.onclick = () => {
        if (!needLogin()) return;
        UI.sheet('订一间房', `<div class="form-row">
          <div class="field"><label>联系人</label><input class="input" id="contact" value="小梅" /></div>
          <div class="field"><label>手机号</label><input class="input" id="phone" value="13700000001" /></div></div>
          <button class="btn btn-primary btn-block" id="go">订下</button>`, (m) => {
          m.querySelector('#go').onclick = async () => {
            try {
              const r = await API.post('/api/homestay-bookings', {
                homestay_id: Number(id), room_id: Number(b.dataset.room),
                guests: Number(document.getElementById('guests').value),
                check_in: document.getElementById('ci').value,
                check_out: document.getElementById('co').value,
                contact: m.querySelector('#contact').value,
                phone: m.querySelector('#phone').value, requestId: rid() });
              m.remove(); UI.sheet('订好啦', `<p>住 ${r.nights} 晚，共 ${yuan(r.amount)}。</p>
                <p class="small muted">核销码 <b>${E(r.checkin_code)}</b>，到店给店家看一眼。</p>`);
            } catch (e) { UI.toast(e.message); }
          };
        });
      };
    });
  }

  /* ---------- 商城 / 购物车 / 结算 ---------- */
  async function shop() {
    setTop('自家做的，卖完等下一季');
    const [cats, d] = await Promise.all([API.get('/api/categories'), API.get('/api/products?pageSize=50')]);
    app.innerHTML = `<div class="field"><input class="input" id="kw" placeholder="搜青梅酒、蜜饯、礼盒" /></div>
      <div style="display:flex;gap:6px;overflow-x:auto;margin-bottom:12px" id="cats">
        <button class="btn btn-sm cat on" data-cat="">全部</button>
        ${cats.map((c) => `<button class="btn btn-sm cat" data-cat="${c.id}">${E(c.name)}</button>`).join('')}</div>
      <div class="grid grid-2" id="goods"></div>
      <a class="btn btn-block" style="margin-top:14px" href="#/cart">去购物车看看</a>`;
    const draw = (items) => {
      document.getElementById('goods').innerHTML = items.length ? items.map((p) => `
        <a class="card" style="padding:0;overflow:hidden" href="#/product/${p.id}">
          ${UI.img(p.image, 'img-1-1')}<div style="padding:10px">
          <div class="small ellipsis"><b>${E(p.name)}</b></div>
          <div class="small muted ellipsis">${E(p.subtitle)}</div>
          <div>${yuan(p.price)} <span class="small muted">已售 ${p.sales}</span></div></div></a>`).join('')
        : UI.empty('这批卖完了，看看别的');
    };
    draw(d.records);
    let cat = '';
    const reload = async () => {
      const r = await API.get('/api/products?pageSize=50&category_id=' + cat +
        '&keyword=' + encodeURIComponent(document.getElementById('kw').value));
      draw(r.records);
    };
    document.getElementById('kw').oninput = reload;
    document.querySelectorAll('.cat').forEach((b) => b.onclick = () => {
      document.querySelectorAll('.cat').forEach((x) => x.classList.remove('btn-primary'));
      b.classList.add('btn-primary'); cat = b.dataset.cat; reload();
    });
  }

  async function productDetail(id) {
    const d = await API.get('/api/products/' + id);
    setTop(d.name);
    app.innerHTML = `${UI.img(d.image, 'img-1-1')}
      <div class="card" style="margin-top:12px"><h3>${E(d.name)}</h3>
        <div class="small muted">${E(d.subtitle)}</div>
        <p class="small" style="margin-top:8px">${E(d.intro)}</p>
        <div style="margin-top:8px">${yuan(d.price)}
          <span class="small muted"> · 库里还有 ${d.stock} 件 · 已售 ${d.sales}</span></div>
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="btn" style="flex:1" id="add">放进购物车</button>
          <button class="btn btn-primary" style="flex:1" id="buy">这就买</button></div></div>`;
    document.getElementById('add').onclick = async () => {
      if (!needLogin()) return;
      try { await API.post('/api/cart', { product_id: Number(id), quantity: 1 }); UI.toast('放进篮子了'); }
      catch (e) { UI.toast(e.message); }
    };
    document.getElementById('buy').onclick = () => {
      if (!needLogin()) return;
      sessionStorage.setItem('plum_direct', JSON.stringify([{ product_id: Number(id), quantity: 1 }]));
      Router.go('/cart');
    };
  }

  async function cart() {
    setTop('挑好了就结账');
    if (!needLogin()) return;
    const d = await API.get('/api/cart');
    const direct = JSON.parse(sessionStorage.getItem('plum_direct') || 'null');
    const items = direct ? [] : d.items;
    app.innerHTML = `<div id="cartList">${items.length ? items.map((i) => `
      <div class="list-item">${UI.img(i.image, 'img-1-1')}
        <div class="body"><h4>${E(i.name)}</h4><div class="small muted">${yuan(i.price)} × ${i.quantity}</div>
        <button class="btn btn-sm" data-del="${i.id}" ${direct ? 'disabled' : ''}>拿掉</button></div></div>`).join('')
      : UI.empty(direct ? '这就买一件，填个地址就能下单' : '篮子还空着，去逛逛')}</div>
      <div class="card" style="margin-top:12px">
        <div style="display:flex;justify-content:space-between"><span>合计</span>
          <b class="price" style="font-size:18px">${direct ? '' : '¥' + E(d.total)}</b></div>
        <div class="field" style="margin-top:12px"><label>收货人</label><input class="input" id="receiver" value="小梅" /></div>
        <div class="field"><label>手机号</label><input class="input" id="phone" value="13700000001" /></div>
        <div class="field"><label>寄到哪儿</label><input class="input" id="address" value="四川省成都市武侯区青梅巷1号" /></div>
        <button class="btn btn-primary btn-block" id="checkout">下单</button></div>`;
    if (!direct) document.querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => {
      await API.del('/api/cart/' + b.dataset.del); cart();
    });
    document.getElementById('checkout').onclick = async () => {
      try {
        const payload = { receiver: document.getElementById('receiver').value,
          phone: document.getElementById('phone').value,
          address: document.getElementById('address').value, requestId: rid() };
        if (direct) payload.items = direct;
        const r = await API.post('/api/orders', payload);
        sessionStorage.removeItem('plum_direct');
        UI.sheet('下单啦', `<p>单号 ${E(r.order_no)}，合计 ${yuan(r.amount)}。</p>
          <button class="btn btn-primary btn-block" id="payNow">现在付</button>`, (m) => {
          m.querySelector('#payNow').onclick = async () => {
            try { await API.post('/api/orders/' + r.id + '/pay', {}); m.remove();
              UI.toast('付好啦，农户这就给您备货'); Router.go('/mine'); }
            catch (e) { UI.toast(e.message); }
          };
        });
      } catch (e) { UI.toast(e.message); }
    };
  }

  /* ---------- 文化节 / 集章 ---------- */
  async function festivals() {
    setTop('镇上一年到头的热闹');
    const d = await API.get('/api/festivals');
    app.innerHTML = d.map((f) => `<div class="card" style="padding:0;overflow:hidden;margin-bottom:12px">
      ${UI.img(f.image, 'img-16-9')}<div style="padding:12px">
      <b>${E(f.title)}</b> ${UI.badge(f.festival_date)}
      <p class="small muted" style="margin-top:6px">${E(f.intro)}</p>
      <div class="small muted">${E(f.place)}</div></div></div>`).join('');
  }

  async function checkin() {
    setTop('一路盖章，集齐换份伴手礼');
    const d = await API.get('/api/checkin-spots');
    const spots = d.spots || [];
    app.innerHTML = `<div class="card" style="background:var(--green-soft);text-align:center">
      <div style="font-size:26px;font-weight:700">${d.stamped} / ${d.total}</div>
      <div class="small muted">已经盖到的章 · 六枚集齐能换一份青梅伴手礼</div></div>
      <div class="section-head"><h3>章都在哪儿</h3></div>
      <div class="map-box" id="stampMap"></div>
      <div style="margin-top:12px">${spots.map((s) => `
        <div class="card" style="margin-bottom:10px;display:flex;gap:10px;align-items:center">
          ${UI.img(s.image, 'img-1-1', 'style="width:62px;flex:0 0 62px"')}
          <div style="flex:1"><b class="small">${E(s.name)}</b>
            <div class="small muted">${E(s.intro)}</div><span class="tag">${E(s.badge)}</span></div>
          <button class="btn btn-sm ${s.stamped ? '' : 'btn-primary'}" data-spot="${s.id}"
            ${s.stamped ? 'disabled' : ''}>${s.stamped ? '盖过了' : '盖章'}</button></div>`).join('')}</div>`;
    document.getElementById('stampMap').innerHTML = mapSVG(spots, (s) =>
      UI.sheet(s.name, `<p class="small">${E(s.intro)}</p><p class="small muted">${E(s.badge)}</p>`));
    document.querySelectorAll('[data-spot]').forEach((b) => b.onclick = async () => {
      if (!needLogin()) return;
      try { const r = await API.post('/api/checkin', { spot_id: Number(b.dataset.spot) });
        UI.toast(r.tip); checkin(); } catch (e) { UI.toast(e.message); }
    });
  }

  /* ---------- AI 助手 ---------- */
  async function ai() {
    setTop('有不明白的，问小梅');
    app.innerHTML = `<div style="display:flex;gap:6px;margin-bottom:12px;overflow-x:auto">
      ${[['ai-chat', '问一句'], ['ai-write', '写吆喝话'], ['ai-trip', '排个行程'], ['ai-speak', '听讲解']]
        .map(([k, n]) => `<button class="btn btn-sm ai-tab ${k === currentTab ? 'btn-primary' : ''}"
          data-tab="${k}">${n}</button>`).join('')}</div><div id="aiBody"></div>`;
    document.querySelectorAll('.ai-tab').forEach((b) => b.onclick = () => {
      currentTab = b.dataset.tab; ai();
    });
    const box = document.getElementById('aiBody');
    if (currentTab === 'ai-chat') {
      box.innerHTML = `<section class="ai-chat">
        <div class="ai-hero card">
          <div class="ai-avatar" aria-hidden="true">梅</div>
          <div class="ai-hero-text"><b>小梅</b></div>
        </div>
        <div class="ai-mode" id="aiMode">
          <button class="btn btn-sm ai-mode-btn on" type="button" data-mode="auto">先查本地</button>
          <button class="btn btn-sm ai-mode-btn" type="button" data-mode="llm">问外部大模型</button>
        </div>
        <div class="ai-msgs" id="msgs"></div>
        <div class="ai-asks" id="asks"></div>
        <form class="ai-search" id="aiForm" autocomplete="off">
          <label class="ai-search-field" for="q">
            <span class="ai-search-icon" aria-hidden="true">⌕</span>
            <input class="input ai-search-input" id="q" placeholder="比如：周末还有位置吗？" />
          </label>
          <button class="btn btn-primary ai-search-btn" id="send" type="submit">问一句</button>
        </form>
      </section>`;
      let mode = 'auto', aiSession = '';
      document.querySelectorAll('.ai-mode-btn').forEach((b) => b.onclick = () => {
        mode = b.dataset.mode;
        document.querySelectorAll('.ai-mode-btn').forEach((x) => x.classList.toggle('on', x === b));
      });
      const asks = ['青梅酒多少钱？', '周末还有位置吗？', '住一晚多少钱？', '什么时候来最好？'];
      const renderAsks = (list) => {
        document.getElementById('asks').innerHTML = (list || []).map((a) =>
          `<button class="btn btn-sm ai-ask" type="button">${E(a)}</button>`).join('');
        document.querySelectorAll('.ai-ask').forEach((b) => b.onclick = () => send(b.textContent));
      };
      const send = async (text) => {
        const input = document.getElementById('q');
        const btn = document.getElementById('send');
        const q = String(text || '').trim();
        if (!q) { input.focus(); return; }
        const msgs = document.getElementById('msgs');
        msgs.insertAdjacentHTML('beforeend', `<div class="chat-bubble me">${E(q)}</div>`);
        input.value = ''; input.focus();
        btn.disabled = true; btn.textContent = '想着…';
        const wait = document.createElement('div');
        wait.className = 'chat-bubble ai-wait';
        wait.textContent = mode === 'llm' ? '正在问外部大模型，免费档通常 5~10 秒…' : '小梅正在翻账本…';
        msgs.appendChild(wait); msgs.scrollTop = msgs.scrollHeight;
        try {
          const r = await API.post('/api/ai/chat', { question: q, mode, session_id: aiSession });
          aiSession = r.session_id || aiSession;
          wait.remove();
          const note = `— ${E(r.source || '平台数据')}${r.model ? ' · ' + E(r.model) : ''}${r.degraded ? ' · 已回退本地' : ''}`;
          msgs.insertAdjacentHTML('beforeend',
            `<div class="chat-bubble">${E(r.answer)}<div class="small muted ai-source">${note}</div></div>`);
          msgs.scrollTop = msgs.scrollHeight;
          if (r.suggestions) renderAsks(r.suggestions);
        } catch (e) {
          wait.remove();
          msgs.insertAdjacentHTML('beforeend',
            `<div class="chat-bubble">${E('这会儿没连上：' + e.message)}</div>`);
          msgs.scrollTop = msgs.scrollHeight;
        } finally {
          btn.disabled = false; btn.textContent = '问一句';
        }
      };
      renderAsks(asks);
      document.getElementById('aiForm').onsubmit = (e) => {
        e.preventDefault(); send(document.getElementById('q').value);
      };
    } else if (currentTab === 'ai-write') {
      const prods = await API.get('/api/products?pageSize=8');
      box.innerHTML = `<div class="card"><div class="field"><label>写点什么</label>
          <select class="select" id="kind"><option value="product">产品文案</option>
          <option value="activity">活动海报文案</option><option value="script">短视频脚本</option></select></div>
        <div class="field"><label>拿哪件东西写</label><select class="select" id="target">
          ${prods.records.map((p) => `<option value="${p.id}">${E(p.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary btn-block" id="go">写一段</button></div>
        <div id="genOut" style="margin-top:12px"></div>`;
      document.getElementById('go').onclick = async () => {
        try {
          const r = await API.post('/api/ai/generate', { type: document.getElementById('kind').value,
            target_id: Number(document.getElementById('target').value) });
          document.getElementById('genOut').innerHTML = `<div class="card"><div class="small muted">
            照着「${E(r.based_on)}」的真实信息写的</div>
            <div style="white-space:pre-wrap;margin-top:8px">${E(r.content)}</div>
            <button class="btn btn-sm" id="copy" style="margin-top:10px">复制走</button></div>`;
          document.getElementById('copy').onclick = () => {
            navigator.clipboard && navigator.clipboard.writeText(r.content); UI.toast('复制好了');
          };
        } catch (e) { UI.toast(e.message); }
      };
    } else if (currentTab === 'ai-trip') {
      box.innerHTML = `<div class="card"><div class="field"><label>打算待几天</label>
        <select class="select" id="days"><option value="1">一日游，当天回</option>
        <option value="2">两日游，住一晚</option></select></div>
        <button class="btn btn-primary btn-block" id="go">排一下</button></div>
        <div id="tripOut" style="margin-top:12px"></div>`;
      document.getElementById('go').onclick = async () => {
        try {
          const r = await API.post('/api/ai/itinerary', { days: Number(document.getElementById('days').value) });
          document.getElementById('tripOut').innerHTML = `<div class="card" style="white-space:pre-wrap">${E(r.itinerary)}</div>`;
        } catch (e) { UI.toast(e.message); }
      };
    } else {
      const spots = await API.get('/api/checkin-spots');
      box.innerHTML = `<div class="card"><div class="field"><label>想听哪儿</label>
        <select class="select" id="spot">${spots.spots.map((s) =>
          `<option value="${s.id}">${E(s.name)}</option>`).join('')}</select></div>
        <button class="btn btn-primary btn-block" id="go">念一段</button></div>
        <div id="speakOut" style="margin-top:12px"></div>`;
      document.getElementById('go').onclick = async () => {
        try {
          const r = await API.post('/api/ai/tts', { target_id: Number(document.getElementById('spot').value) });
          document.getElementById('speakOut').innerHTML = `<div class="card"><b>${E(r.title)}</b>
            <p style="white-space:pre-wrap;margin-top:8px">${E(r.text)}</p>
            <button class="btn btn-primary btn-block" id="play" style="margin-top:8px">听一遍</button></div>`;
          document.getElementById('play').onclick = () => {
            if (!('speechSynthesis' in window)) return UI.toast(r.tip);
            if (speechSynthesis.speaking) { speechSynthesis.cancel(); UI.toast('停下了'); return; }
            speechSynthesis.cancel();
            r.segments.forEach((s) => { const u = new SpeechSynthesisUtterance(s);
              u.lang = 'zh-CN'; u.rate = .95; speechSynthesis.speak(u); });
            UI.toast('开始念了');
          };
        } catch (e) { UI.toast(e.message); }
      };
    }
  }

  /* ---------- 我的 / 登录 ---------- */
  async function mine() {
    setTop('我的镇上账本');
    if (!Session.id()) { Router.go('/login'); return; }
    const [overview, orders] = await Promise.all([API.get('/api/my/overview'), API.get('/api/my/orders')]);
    app.innerHTML = `<div class="card" style="text-align:center">
      <b>${E(overview.nickname)}</b> <span class="tag">${E(overview.role)}</span></div>
      <div class="stat-grid" style="margin:12px 0">
        ${[['订单', overview.counts.orders], ['预约', overview.counts.reservations],
           ['研学', overview.counts.research], ['集章', overview.counts.stamps]].map(([n, v]) =>
          `<div class="stat"><div class="label">${n}</div><div class="value">${v}</div></div>`).join('')}</div>
      <div class="section-head"><h3>我的核销码</h3></div>
      ${overview.bookings.length ? overview.bookings.map((b) => `
        <div class="card" style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
          <div><b class="small">${E(b.code)}</b> ${UI.badge(b.status)}
            <div class="small muted">${E(b.type === 'reservation' ? '采摘预约' : b.type === 'research' ? '研学报名' : '民宿预订')}
              · ${E(String(b.date).slice(0, 10))}</div></div>
          <div style="font-family:monospace;font-weight:700">${E(b.checkin_code)}</div></div>`).join('')
        : UI.empty('还没有要核销的码，去约一场吧')}
      <div class="section-head"><h3>我的订单</h3></div>
      ${orders.length ? orders.map((o) => `<div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between"><b class="small">${E(o.order_no)}</b>${UI.badge(o.status)}</div>
        <div class="small muted">${E(String(o.created_at).slice(0, 10))} · ${E(o.receiver)}</div>
        <div style="margin-top:4px">${yuan(o.amount)}
          ${o.status === '待支付' ? `<button class="btn btn-sm btn-primary" style="float:right" data-pay="${o.id}">去付</button>
            <button class="btn btn-sm" style="float:right;margin-right:6px" data-cancel="${o.id}">不要了</button>` : ''}</div>
      </div>`).join('') : UI.empty('还没下过单')}`;
    document.querySelectorAll('[data-pay]').forEach((b) => b.onclick = async () => {
      try { await API.post('/api/orders/' + b.dataset.pay + '/pay', {}); UI.toast('付好啦'); mine(); }
      catch (e) { UI.toast(e.message); }
    });
    document.querySelectorAll('[data-cancel]').forEach((b) => b.onclick = async () => {
      try { await API.post('/api/orders/' + b.dataset.cancel + '/cancel', {}); UI.toast('已取消'); mine(); }
      catch (e) { UI.toast(e.message); }
    });
  }

  function login() {
    setTop('登录一下，接着逛');
    app.innerHTML = `<div class="card" style="margin-top:20px">
      <h3>欢迎来镇上</h3>
      <div class="field" style="margin-top:14px"><label>账号</label><input class="input" id="u" value="tourist01" /></div>
      <div class="field"><label>口令</label><input class="input" id="p" type="password" value="tourist123" /></div>
      <button class="btn btn-primary btn-block" id="go">进来</button></div>`;
    document.getElementById('go').onclick = async () => {
      try {
        const d = await API.post('/api/auth/login', { username: document.getElementById('u').value,
          password: document.getElementById('p').value });
        Session.set(d.sessionId, { nickname: d.nickname, role: d.role });
        syncAccount(); UI.toast('进来啦，慢慢逛'); Router.go('/home');
      } catch (e) { UI.toast(e.message); }
    };
  }

  const routes = {
    '/home': home, '/orchards': orchardList, '/research': researchList,
    '/homestays': homestayList, '/shop': shop, '/cart': cart, '/ai': ai,
    '/festivals': festivals, '/checkin': checkin, '/mine': mine, '/login': login,
  };

  Router.on(async (path) => {
    clearInterval(carouselTimer);
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    syncAccount(); syncTab(path);
    const parts = path.split('/');
    let handler = routes[path], arg = null;
    if (!handler && parts[1] === 'orchard') { handler = orchardDetail; arg = parts[2]; }
    if (!handler && parts[1] === 'research') { handler = researchDetail; arg = parts[2]; }
    if (!handler && parts[1] === 'homestay') { handler = homestayDetail; arg = parts[2]; }
    if (!handler && parts[1] === 'product') { handler = productDetail; arg = parts[2]; }
    if (!handler) { handler = home; }
    app.innerHTML = UI.loading();
    try { await handler(arg); } catch (e) {
      if (e.code === 401 || e.code === 403) { Router.go('/login'); return; }
      app.innerHTML = `<div class="card"><b>这页没打开</b><p class="small muted">${E(e.message)}</p>
        <button class="btn btn-sm" onclick="location.hash='#/home'">回首页</button></div>`;
    }
    window.scrollTo(0, 0);
  });
})();
