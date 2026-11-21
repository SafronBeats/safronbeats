/* SAFRON BEATS — kits & plugins shop */

(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const CART_KEY = 'sb_cart_v1';
  const KIND = document.body.dataset.shop === 'plugin' ? 'plugin' : 'kit';
  const NOUN = KIND === 'plugin' ? 'Plugin' : 'Sample kit';
  const ART_PALETTE = [
    ['#d9c8a4', '#2a2118'],
    ['#c2b8a3', '#221d17'],
    ['#b9a78c', '#241c14'],
    ['#a8b09a', '#1e241c'],
    ['#c9a37e', '#2a1d13'],
    ['#9fa6ad', '#1b2026'],
    ['#cbbd9a', '#262017'],
    ['#b8a1a0', '#261b1c'],
  ];

  let CONFIG = null;
  let ITEMS = [];
  const audio = new Audio();
  let playingId = null;

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function money(n) {
    const cur = CONFIG?.currency || 'USD';
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(n || 0));
    } catch {
      return '$' + Number(n || 0).toFixed(2);
    }
  }
  function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }
  function artHTML(item) {
    if (item.cover) return `<img src="${esc(item.cover)}" alt="${esc(item.title)} cover art" loading="lazy">`;
    const [bg, ink] = ART_PALETTE[hash(item.id || item.title) % ART_PALETTE.length];
    return `<div class="art-type" style="--art-bg:${bg};color:${ink}">${esc(item.title)}<small>SAFRON BEATS</small></div>`;
  }
  function toast(msg, bad) {
    const el = document.createElement('div');
    el.className = 'toast' + (bad ? ' bad' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  /* ---------- cart ---------- */

  function readCart() {
    try {
      const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
      return Array.isArray(c) ? c : [];
    } catch {
      return [];
    }
  }
  function writeCart(items) {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
    renderCount();
  }
  function renderCount() {
    const n = readCart().length;
    const el = $('#cartCount');
    if (!el) return;
    el.textContent = n;
    el.dataset.empty = n === 0 ? 'true' : 'false';
  }
  function addToCart(item) {
    const cart = readCart();
    if (cart.some((i) => i.beatId === item.id)) {
      toast('Already in your cart');
      openCart();
      return;
    }
    cart.push({
      beatId: item.id,
      slug: item.slug,
      title: item.title,
      kind: KIND,
      tier: 'single',
      tierName: NOUN,
      amount: item.price,
      cover: item.cover || null,
    });
    writeCart(cart);
    toast('Added — ' + item.title);
    openCart();
  }
  function renderCart() {
    const cart = readCart();
    const body = $('#cartBody');
    if (!body) return;
    if (!cart.length) {
      body.innerHTML = `<div style="padding:56px 8px;text-align:center">
        <p style="color:var(--muted);font-size:13px;margin:0 0 16px">Nothing here yet.</p>
        <a class="btn small" href="/" >Browse beats</a></div>`;
    } else {
      body.innerHTML = cart
        .map(
          (i, idx) => `<div class="cart-line">
          <div class="cart-line-art">${
            i.cover
              ? `<img src="${esc(i.cover)}" alt="">`
              : `<div class="art-type compact" style="--art-bg:#d9c8a4;color:#2a2118"><span class="art-mono">${esc(
                  i.title.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join(' ')
                )}</span></div>`
          }</div>
          <div>
            <div class="cart-line-title">${esc(i.title)}</div>
            <div class="cart-line-sub">${esc(i.tierName)}</div>
            <button class="link-x" data-remove="${idx}" style="margin-top:5px">Remove</button>
          </div>
          <div class="cart-line-price">${money(i.amount)}</div>
        </div>`
        )
        .join('');
      $$('[data-remove]', body).forEach((btn) =>
        btn.addEventListener('click', () => {
          const c = readCart();
          c.splice(Number(btn.dataset.remove), 1);
          writeCart(c);
          renderCart();
        })
      );
    }
    const total = cart.reduce((s, i) => s + Number(i.amount || 0), 0);
    const t = $('#cartTotal');
    if (t) t.textContent = money(total);
  }
  function openCart() {
    renderCart();
    $('#cartDrawer')?.classList.add('open');
    $('#cartDrawer')?.setAttribute('aria-hidden', 'false');
    $('#scrim')?.classList.add('open');
  }
  function closeCart() {
    $('#cartDrawer')?.classList.remove('open');
    $('#cartDrawer')?.setAttribute('aria-hidden', 'true');
    $('#scrim')?.classList.remove('open');
  }

  /* ---------- render ---------- */

  function card(item) {
    const meta = [item.format, item.kind === 'plugin' ? 'Instant download' : 'ZIP / RAR'].filter(Boolean);
    return `<article class="beat" data-id="${esc(item.id)}">
      <div class="beat-art" ${item.preview ? `data-play="${esc(item.id)}" role="button" tabindex="0" aria-label="Preview ${esc(item.title)}"` : ''}>
        ${artHTML(item)}
        ${item.preview ? `<button class="play-fab" tabindex="-1" aria-label="Preview ${esc(item.title)}"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg></button>` : ''}
      </div>
      <div class="beat-info">
        <div class="beat-title-row">
          <h3 class="beat-title">${esc(item.title)}</h3>
          <div class="beat-price"><b>${money(item.price)}</b></div>
        </div>
        <div class="beat-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
        <div class="beat-actions">
          <button class="btn small solid" data-add="${esc(item.id)}">Add to cart</button>
          ${item.preview ? `<button class="btn small ghost" data-play="${esc(item.id)}">Preview</button>` : ''}
        </div>
      </div>
    </article>`;
  }

  function render() {
    const grid = $('#shopGrid');
    grid.innerHTML = ITEMS.map(card).join('');
    $('#shopCount').textContent = `${ITEMS.length} ${ITEMS.length === 1 ? (KIND === 'plugin' ? 'plugin' : 'kit') : KIND === 'plugin' ? 'plugins' : 'kits'}`;
    $('#shopEmpty').hidden = ITEMS.length > 0;

    $$('[data-add]', grid).forEach((btn) =>
      btn.addEventListener('click', () => {
        const item = ITEMS.find((i) => i.id === btn.dataset.add);
        if (item) addToCart(item);
      })
    );
    $$('[data-play]', grid).forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        preview(el.dataset.play);
      });
    });
  }

  function preview(id) {
    const item = ITEMS.find((i) => i.id === id);
    if (!item || !item.preview) return;
    if (playingId === id && !audio.paused) {
      audio.pause();
      playingId = null;
      syncPlaying();
      return;
    }
    playingId = id;
    audio.src = item.preview;
    audio.play().then(syncPlaying).catch(() => toast('Tap to play'));
    audio.onended = () => {
      playingId = null;
      syncPlaying();
    };
    syncPlaying();
  }

  function syncPlaying() {
    $$('.beat').forEach((el) => {
      const on = el.dataset.id === playingId && !audio.paused;
      el.classList.toggle('is-playing', on);
      const fab = $('.play-fab', el);
      if (fab) {
        fab.innerHTML = on
          ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
      }
    });
  }

  /* ---------- boot ---------- */

  $('#cartOpen')?.addEventListener('click', openCart);
  $('#cartClose')?.addEventListener('click', closeCart);
  $('#scrim')?.addEventListener('click', closeCart);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeCart();
  });

  async function boot() {
    $('#year').textContent = new Date().getFullYear();
    renderCount();
    try {
      const [cfgRes, listRes] = await Promise.all([fetch('/api/config'), fetch(`/api/beats?kind=${KIND}`)]);
      CONFIG = await cfgRes.json();
      const data = await listRes.json();
      ITEMS = data.beats || [];
      render();
      renderCart();
    } catch (err) {
      console.error(err);
      toast('Could not load the shop', true);
    }
  }

  boot();
})();
