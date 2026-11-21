/* SAFRONBEATS — storefront */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const CART_KEY = 'sb_cart_v1';
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
let BEATS = [];
let current = null;
let selectedTier = null;
let activeBeat = null;

/* ---------- utils ---------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(n, currency) {
  const cur = currency || CONFIG?.currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(n || 0));
  } catch {
    return `$${Number(n || 0).toFixed(2)}`;
  }
}

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

function artHTML(beat, { compact = 0 } = {}) {
  if (beat.cover) return `<img src="${esc(beat.cover)}" alt="${esc(beat.title)} cover art" loading="lazy">`;
  const [bg, ink] = ART_PALETTE[hash(beat.id || beat.slug || beat.title) % ART_PALETTE.length];
  const title = String(beat.title || 'Untitled');
  if (compact) {
    const initials = title
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, compact > 1 ? 3 : 2)
      .map((w) => w[0])
      .join(' ');
    return `<div class="art-type compact" style="--art-bg:${bg};color:${ink}"><span class="art-mono">${esc(initials)}</span></div>`;
  }
  return `<div class="art-type" style="--art-bg:${bg};color:${ink}">${esc(title)}<small>SAFRON BEATS</small></div>`;
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function toast(msg, bad = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3600);
}

/* ---------- cart ---------- */

function readCart() {
  try {
    const raw = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  renderCartCount();
}

function addToCart(beat, tierKey, tierName, amount) {
  const cart = readCart();
  const existing = cart.find((i) => i.beatId === beat.id);
  if (existing) {
    if (existing.tier === tierKey) {
      toast('Already in your cart');
      return;
    }
    existing.tier = tierKey;
    existing.tierName = tierName;
    existing.amount = amount;
    writeCart(cart);
    toast(`License updated — ${tierName}`);
  } else {
    cart.push({
      beatId: beat.id,
      slug: beat.slug,
      title: beat.title,
      tier: tierKey,
      tierName,
      amount,
      cover: beat.cover || null,
    });
    writeCart(cart);
    toast(`Added — ${beat.title} (${tierName})`);
  }
  openCart();
}

function renderCartCount() {
  const n = readCart().length;
  const el = $('#cartCount');
  if (!el) return;
  el.textContent = n;
  el.dataset.empty = n === 0 ? 'true' : 'false';
}

function renderCart() {
  const cart = readCart();
  const body = $('#cartBody');
  if (!body) return;
  if (!cart.length) {
    body.innerHTML = `<div style="padding:56px 8px;text-align:center">
      <p style="color:var(--muted);font-size:13px;margin:0 0 16px">Nothing here yet. Pick a beat and a license.</p>
      <a class="btn small" href="#catalog" id="cartBrowse">Browse beats</a></div>`;
    const b = $('#cartBrowse');
    if (b) b.addEventListener('click', closeCart);
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
            <div class="cart-line-files">${esc(tierFiles(i.tier))}</div>
            <button class="link-x" data-remove="${idx}" style="margin-top:5px">Remove</button>
          </div>
          <div class="cart-line-price">${money(i.amount)}</div>
        </div>`
      )
      .join('');
    $$('[data-remove]', body).forEach((btn) =>
      btn.addEventListener('click', () => {
        const cart2 = readCart();
        cart2.splice(Number(btn.dataset.remove), 1);
        writeCart(cart2);
        renderCart();
        renderCartCount();
      })
    );
  }
  const total = cart.reduce((s, i) => s + Number(i.amount || 0), 0);
  const t = $('#cartTotal');
  if (t) t.textContent = money(total);
  const cb = $('#checkoutBtn');
  if (cb) cb.setAttribute('aria-disabled', cart.length ? 'false' : 'true');
}

function tierFiles(key) {
  if (key === 'single') return 'Digital download';
  const t = (CONFIG?.tiers || []).find((x) => x.key === key);
  if (!t) return '';
  return 'Includes ' + t.files.map((f) => f.toUpperCase()).join(' · ');
}

function openCart() {
  renderCart();
  $('#cartDrawer').classList.add('open');
  $('#cartDrawer').setAttribute('aria-hidden', 'false');
  $('#scrim').classList.add('open');
}
function closeCart() {
  $('#cartDrawer').classList.remove('open');
  $('#cartDrawer').setAttribute('aria-hidden', 'true');
  $('#scrim').classList.remove('open');
}

/* ---------- rendering ---------- */

function beatCard(beat) {
  const from = Math.min(...Object.values(beat.prices || {}).filter((n) => n > 0));
  const tags = (beat.tags || []).slice(0, 3);
  return `<article class="beat" data-id="${esc(beat.id)}" data-genre="${esc(beat.genre || '')}" data-title="${esc(beat.title)}" data-tags="${esc((beat.tags || []).join(' '))}" data-bpm="${beat.bpm || 0}" data-price="${Number.isFinite(from) ? from : 0}">
    <div class="beat-art" data-play="${esc(beat.id)}" role="button" tabindex="0" aria-label="Play ${esc(beat.title)}">
      ${artHTML(beat)}
      ${beat.exclusiveSold ? '<span class="beat-badge sold">Exclusive sold</span>' : beat.published === false ? '<span class="beat-badge">Draft</span>' : ''}
      <button class="play-fab" aria-label="Play ${esc(beat.title)}" tabindex="-1">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>
      </button>
    </div>
    <div class="beat-info">
      <div class="beat-title-row">
        <h3 class="beat-title">${esc(beat.title)}</h3>
        <div class="beat-price"><b>${money(from)}</b></div>
      </div>
      <div class="beat-meta">
        ${beat.bpm ? `<span>${esc(beat.bpm)} BPM</span>` : ''}
        ${beat.key ? `<span>${esc(beat.key)}</span>` : ''}
        ${beat.genre ? `<span>${esc(beat.genre)}</span>` : ''}
        ${beat.duration ? `<span>${fmtTime(beat.duration)}</span>` : ''}
      </div>
      ${tags.length ? `<div class="beat-tags">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="beat-actions">
        <button class="btn small" data-license="${esc(beat.id)}" ${beat.exclusiveSold ? 'disabled' : ''}>
          ${beat.exclusiveSold ? 'Sold out' : 'Licenses'}
        </button>
        <button class="btn small solid" data-quickadd="${esc(beat.id)}" ${beat.exclusiveSold ? 'disabled' : ''}>Add</button>
      </div>
    </div>
  </article>`;
}

function renderGrid() {
  const grid = $('#grid');
  const q = ($('#search')?.value || '').toLowerCase().trim();
  const genre = $('.filter-chip[aria-pressed="true"]')?.dataset.genre || '';
  const sort = $('#sort')?.value || 'new';

  let list = BEATS.filter((b) => {
    if (genre && (b.genre || '').toLowerCase() !== genre.toLowerCase()) return false;
    if (!q) return true;
    const hay = [b.title, b.genre, ...(b.tags || []), b.key].join(' ').toLowerCase();
    return hay.includes(q);
  });

  const priceOf = (b) => Math.min(...Object.values(b.prices || {}).filter((n) => n > 0), Infinity);
  if (sort === 'low') list.sort((a, b) => priceOf(a) - priceOf(b));
  else if (sort === 'high') list.sort((a, b) => priceOf(b) - priceOf(a));
  else if (sort === 'bpm') list.sort((a, b) => (b.bpm || 0) - (a.bpm || 0));
  else list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  grid.innerHTML = list.map(beatCard).join('');
  $('#catalogCount').textContent = `${list.length} ${list.length === 1 ? 'track' : 'tracks'}`;
  $('#emptyState').hidden = list.length > 0 || BEATS.length > 0;

  $$('[data-play]', grid).forEach((el) => {
    el.addEventListener('click', () => playBeat(el.dataset.play));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        playBeat(el.dataset.play);
      }
    });
  });
  $$('[data-license]', grid).forEach((el) => el.addEventListener('click', () => openLicense(el.dataset.license)));
  $$('[data-quickadd]', grid).forEach((el) =>
    el.addEventListener('click', () => {
      const beat = BEATS.find((b) => b.id === el.dataset.quickadd);
      if (!beat) return;
      const tier = cheapestAvailableTier(beat);
      if (!tier) return;
      addToCart(beat, tier.key, tier.name, beat.prices[tier.key]);
    })
  );
  syncPlayingStates();
}

function cheapestAvailableTier(beat) {
  return (CONFIG?.tiers || []).find((t) => {
    if (t.exclusive && beat.exclusiveSold) return false;
    if (t.files.includes('wav') && !beat.has.wav) return false;
    if (t.files.includes('stems') && !beat.has.stems) return false;
    return true;
  });
}

function renderHero() {
  const box = $('#hero');
  if (!box) return;
  if (!BEATS.length) {
    box.hidden = true;
    return;
  }
  const beat = BEATS[0];
  const from = Math.min(...Object.values(beat.prices || {}).filter((n) => n > 0));
  const meta = [beat.bpm && `${beat.bpm} BPM`, beat.key, beat.genre].filter(Boolean);
  box.hidden = false;
  box.innerHTML = `<div class="wrap">
    <div class="hero-grid">
      <div class="hero-art" data-play="${esc(beat.id)}" role="button" tabindex="0" aria-label="Play ${esc(beat.title)}">
        ${artHTML(beat)}
        <button class="play-fab" tabindex="-1" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg></button>
      </div>
      <div class="hero-side">
        <div class="hero-kicker"><span class="eyebrow">Latest drop</span></div>
        <h2 class="hero-title">${esc(beat.title)}</h2>
        <div class="hero-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('')}</div>
        <div class="hero-actions">
          <button class="btn solid" data-license="${esc(beat.id)}">License from ${money(from)}</button>
          <button class="btn" data-play="${esc(beat.id)}">Preview</button>
        </div>
      </div>
    </div>
  </div>`;
  $$('[data-play]', box).forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      playBeat(el.dataset.play);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        playBeat(el.dataset.play);
      }
    });
  });
  $$('[data-license]', box).forEach((el) => el.addEventListener('click', () => openLicense(el.dataset.license)));
}

function renderGenreChips() {
  const genres = [...new Set(BEATS.map((b) => (b.genre || '').trim()).filter(Boolean))].sort();
  const wrap = $('#filters');
  const search = $('.filter-search', wrap);
  $$('.filter-chip', wrap).forEach((c) => c.remove());
  genres.slice(0, 7).forEach((g) => {
    const b = document.createElement('button');
    b.className = 'filter-chip';
    b.dataset.genre = g;
    b.setAttribute('aria-pressed', 'false');
    b.textContent = g;
    wrap.insertBefore(b, search);
  });
  $$('.filter-chip', wrap).forEach((chip) =>
    chip.addEventListener('click', () => {
      $$('.filter-chip', wrap).forEach((c) => c.setAttribute('aria-pressed', 'false'));
      chip.setAttribute('aria-pressed', 'true');
      renderGrid();
    })
  );
}

/* ---------- player ---------- */

const audio = $('#audio');
let queue = [];
let queueIndex = -1;

function syncPlayingStates() {
  $$('.beat').forEach((el) => {
    const on = current && el.dataset.id === current.id && !audio.paused;
    el.classList.toggle('is-playing', !!on);
    const fab = $('.play-fab', el);
    if (fab) fab.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4h4v16H7zM13 4h4v16h-4z"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
  });
}

function playBeat(id) {
  const beat = BEATS.find((b) => b.id === id);
  if (!beat || !beat.preview) {
    toast('Preview not uploaded yet', true);
    return;
  }
  if (current && current.id === beat.id) {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
    return;
  }
  current = beat;
  queue = BEATS.filter((b) => b.preview);
  queueIndex = queue.findIndex((b) => b.id === beat.id);
  $('#playerTitle').textContent = beat.title;
  $('#playerSub').textContent = [beat.bpm && beat.bpm + ' BPM', beat.key, beat.genre].filter(Boolean).join(' · ');
  $('#playerArt').innerHTML = artHTML(beat, { compact: 1 });
  audio.src = beat.preview;
  audio.play().catch(() => {
    // Some browsers block play() without a gesture; resume on the next tap.
    const resume = () => {
      audio.play().catch(() => {});
      document.removeEventListener('pointerdown', resume);
    };
    document.addEventListener('pointerdown', resume, { once: true });
    toast('Tap anywhere to start audio');
  });
  $('#player').classList.add('open');
  document.body.style.paddingBottom = '84px';
}

$('#playBtn')?.addEventListener('click', () => {
  if (!current) {
    if (BEATS[0]) playBeat(BEATS[0].id);
    return;
  }
  if (audio.paused) audio.play().catch(() => {});
  else audio.pause();
});

audio?.addEventListener('pause', syncPlayingStates);
audio?.addEventListener('play', syncPlayingStates);
audio?.addEventListener('timeupdate', () => {
  const d = audio.duration || 0;
  const pct = d ? (audio.currentTime / d) * 100 : 0;
  $('#playerFill').style.width = pct + '%';
  $('#playerCur').textContent = fmtTime(audio.currentTime);
  $('#playerDur').textContent = fmtTime(d);
  $('#playerBar').setAttribute('aria-valuenow', String(Math.round(pct)));
});
audio?.addEventListener('ended', () => {
  const nextIdx = queueIndex + 1;
  if (queue[nextIdx]) playBeat(queue[nextIdx].id);
  else syncPlayingStates();
});
audio?.addEventListener('loadedmetadata', () => {
  $('#playerDur').textContent = fmtTime(audio.duration);
});

$('#playerBar')?.addEventListener('click', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  if (audio.duration) audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
});

$('#nextBtn')?.addEventListener('click', () => {
  if (!queue.length) return;
  queueIndex = (queueIndex + 1) % queue.length;
  playBeat(queue[queueIndex].id);
});
$('#prevBtn')?.addEventListener('click', () => {
  if (!queue.length) return;
  queueIndex = (queueIndex - 1 + queue.length) % queue.length;
  playBeat(queue[queueIndex].id);
});

let muted = false;
$('#muteBtn')?.addEventListener('click', () => {
  muted = !muted;
  audio.muted = muted;
  $('#muteBtn').style.color = muted ? 'var(--accent)' : '';
});

$('#playerLicense')?.addEventListener('click', () => {
  if (current) openLicense(current.id);
});

/* ---------- license modal ---------- */

function openLicense(id) {
  const beat = BEATS.find((b) => b.id === id);
  if (!beat) return;
  activeBeat = beat;
  selectedTier = null;
  $('#modalTitle').textContent = beat.title;
  $('#modalSub').textContent = [beat.bpm && beat.bpm + ' BPM', beat.key, beat.genre].filter(Boolean).join(' · ');
  $('#modalArt').innerHTML = artHTML(beat, { compact: 2 });
  $('#modalSelected').textContent = '—';

  const tiers = (CONFIG?.tiers || []).filter((t) => !(t.exclusive && beat.exclusiveSold));
  $('#tierList').innerHTML = tiers
    .map((t) => {
      const price = beat.prices[t.key];
      const missing = (t.files.includes('wav') && !beat.has.wav) || (t.files.includes('stems') && !beat.has.stems);
      const label = t.exclusive ? 'Exclusive · make an offer' : money(price);
      return `<label class="tier" data-tier="${esc(t.key)}" data-selected="false" ${missing ? 'style="opacity:.45;cursor:not-allowed"' : ''}>
        <input type="radio" name="tier" value="${esc(t.key)}" ${missing ? 'disabled' : ''}>
        <div>
          <div class="tier-name">${esc(t.name)} ${t.exclusive ? '<span class="tag">One buyer</span>' : `<span class="tag">${esc(t.short)}</span>`}</div>
          <ul class="tier-terms">${t.terms.slice(0, 4).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          ${missing ? '<div class="hint" style="margin-top:6px">Files for this tier are not uploaded for this beat yet.</div>' : ''}
        </div>
        <div class="tier-price">${label}</div>
      </label>`;
    })
    .join('');

  $$('#tierList .tier').forEach((row) => {
    row.addEventListener('click', () => {
      const input = $('input', row);
      if (input.disabled) return;
      input.checked = true;
      $$('#tierList .tier').forEach((r) => r.dataset.selected = 'false');
      row.dataset.selected = 'true';
      selectedTier = row.dataset.tier;
      const tier = tiers.find((t) => t.key === selectedTier);
      $('#modalSelected').textContent = `${tier.name} — ${tier.exclusive ? money(beat.prices.exclusive) : money(beat.prices[selectedTier])}`;
    });
  });

  const first = tiers.find((t) => !(t.files.includes('wav') && !beat.has.wav) && !(t.files.includes('stems') && !beat.has.stems));
  if (first) {
    const row = $(`#tierList .tier[data-tier="${first.key}"]`);
    if (row) row.click();
  }

  $('#licenseModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLicense() {
  $('#licenseModal').classList.remove('open');
  document.body.style.overflow = '';
}

$('#modalClose')?.addEventListener('click', closeLicense);
$('#licenseModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'licenseModal') closeLicense();
});
$('#modalAdd')?.addEventListener('click', () => {
  if (!activeBeat || !selectedTier) return;
  const tier = CONFIG.tiers.find((t) => t.key === selectedTier);
  addToCart(activeBeat, tier.key, tier.name, activeBeat.prices[tier.key]);
  closeLicense();
});

/* ---------- page wiring ---------- */

$('#cartOpen')?.addEventListener('click', openCart);
$('#cartClose')?.addEventListener('click', closeCart);
$('#scrim')?.addEventListener('click', closeCart);
$('#search')?.addEventListener('input', () => {
  clearTimeout(window.__s);
  window.__s = setTimeout(renderGrid, 120);
});
$('#sort')?.addEventListener('change', renderGrid);
$('#checkoutBtn')?.addEventListener('click', (e) => {
  if (!readCart().length) {
    e.preventDefault();
    toast('Your cart is empty', true);
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeLicense();
    closeCart();
  }
});

/* ---------- boot ---------- */

async function boot() {
  $('#year').textContent = new Date().getFullYear();
  renderCartCount();
  try {
    const [cfgRes, beatRes] = await Promise.all([fetch('/api/config'), fetch('/api/beats')]);
    CONFIG = await cfgRes.json();
    const data = await beatRes.json();
    BEATS = (data.beats || []).filter((b) => b.published || isAdminView());
    document.title = `${CONFIG.name} — Underground Hip Hop Instrumentals`;
    $('#mailLink').href = `mailto:${CONFIG.email}`;
    if (CONFIG.instagram) {
      $('#igLink').href = CONFIG.instagram;
      $('#igLink').hidden = false;
    }
    if (CONFIG.youtube) {
      $('#ytLink').href = CONFIG.youtube;
      $('#ytLink').hidden = false;
    }
    renderGenreChips();
    renderGrid();
    renderHero();
    renderCart();
  } catch (err) {
    console.error(err);
    toast('Could not load the catalog', true);
  }
}

function isAdminView() {
  return new URLSearchParams(location.search).get('all') === '1';
}

boot();
