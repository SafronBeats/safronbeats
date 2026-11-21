/* SAFRONBEATS — checkout */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const CART_KEY = 'sb_cart_v1';
let CONFIG = null;
let provider = null;

function money(n) {
  const cur = CONFIG?.currency || 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(n || 0));
  } catch {
    return `$${Number(n || 0).toFixed(2)}`;
  }
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function readCart() {
  try {
    const c = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    return Array.isArray(c) ? c : [];
  } catch {
    return [];
  }
}
function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

async function boot() {
  const cart = readCart();
  if (!cart.length) {
    location.replace('/');
    return;
  }
  const cfgRes = await fetch('/api/config');
  CONFIG = await cfgRes.json();
  renderSummary(cart);
  renderPayMethods();
  $('#buyerEmail').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

function renderSummary(cart) {
  $('#summary').innerHTML = cart
    .map(
      (i) => `<div class="summary-line"><span>${esc(i.title)}<br><span style="color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase">${esc(i.tierName)}</span></span><span>${money(i.amount)}</span></div>`
    )
    .join('');
  const total = cart.reduce((s, i) => s + Number(i.amount || 0), 0);
  $('#total').textContent = money(total);
  $('#payBtn').textContent = `Pay ${money(total)}`;
}

function renderPayMethods() {
  const p = CONFIG.providers || {};
  const options = [];
  if (p.paypal) {
    options.push({ key: 'paypal', name: 'PayPal', sub: 'Pay with your PayPal balance or a card through PayPal', logo: 'PayPal', badge: CONFIG.paypalMode === 'live' ? '' : 'Sandbox' });
  }
  if (p.stripe) {
    options.push({ key: 'stripe', name: 'Card', sub: 'Visa, Mastercard, Amex — processed by Stripe', logo: 'Stripe', badge: '' });
  }
  if (p.demo) {
    options.push({ key: 'demo', name: 'Preview checkout', sub: 'No payment provider connected yet — this simulates a completed purchase so you can test delivery', logo: 'Demo', badge: 'Preview' });
  }
  if (!options.length) {
    $('#payMethods').innerHTML = '<p class="hint">No payment method is configured.</p>';
    return;
  }
  provider = options[0].key;
  $('#payMethods').innerHTML = options
    .map(
      (o, i) => `<label class="pay-option" data-pay="${o.key}" data-selected="${i === 0}">
        <input type="radio" name="provider" value="${o.key}" ${i === 0 ? 'checked' : ''}>
        <div><div class="pay-name">${o.name} ${o.badge ? `<span class="tag" style="font-size:9px;margin-left:6px;border:1px solid var(--line-strong);padding:2px 6px;color:var(--muted)">${o.badge}</span>` : ''}</div><div class="pay-sub">${esc(o.sub)}</div></div>
        <div class="pay-logo" style="color:var(--muted)">${o.logo}</div>
      </label>`
    )
    .join('');

  $$('.pay-option').forEach((row) => {
    row.addEventListener('click', () => {
      $$('.pay-option').forEach((r) => (r.dataset.selected = 'false'));
      row.dataset.selected = 'true';
      $('input', row).checked = true;
      provider = row.dataset.pay;
      updateNotice();
    });
  });
  updateNotice();
}

function updateNotice() {
  const n = $('#payNotice');
  const trust = $('#trustLine');
  if (trust) trust.style.display = provider === 'demo' ? 'none' : 'flex';
  if (provider === 'paypal') {
    n.textContent = CONFIG.paypalMode === 'live'
      ? 'You will be redirected to PayPal to approve the payment, then returned here for your files.'
      : 'PayPal sandbox is active — use a sandbox buyer account to complete the test purchase.';
  } else if (provider === 'stripe') {
    n.textContent = 'You will be redirected to Stripe\'s secure checkout, then returned here for your files.';
  } else {
    n.textContent = 'Preview mode: no money moves. The order is marked paid so you can test downloads and licenses end to end.';
  }
}

$('#checkoutForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#checkoutError');
  err.textContent = '';
  const name = $('#buyerName').value.trim();
  const email = $('#buyerEmail').value.trim();
  const country = $('#buyerCountry').value.trim();
  const agreed = $('#agree').checked;

  if (!name) return fail('Add the name that should appear on the license.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail('That email does not look right — it is where your files are tied to.');
  if (!agreed) return fail('Please accept the license terms to continue.');

  const cart = readCart();
  if (!cart.length) return fail('Your cart is empty.');

  const btn = $('#payBtn');
  btn.disabled = true;
  btn.textContent = 'Working…';

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map((i) => ({ beatId: i.beatId, tier: i.tier })),
        buyer: { name, email, country },
        provider,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Checkout failed');
    localStorage.removeItem(CART_KEY);
    location.href = data.redirect;
  } catch (ex) {
    fail(ex.message);
    btn.disabled = false;
    btn.textContent = `Pay ${money(readCart().reduce((s, i) => s + Number(i.amount || 0), 0))}`;
  }

  function fail(msg) {
    err.textContent = msg;
    toast(msg, true);
  }
});

boot();
