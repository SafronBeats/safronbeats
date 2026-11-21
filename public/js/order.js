/* SAFRONBEATS — order / delivery page */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
let CONFIG = null;

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

const params = new URLSearchParams(location.search);
const orderId = location.pathname.split('/').filter(Boolean).pop();

async function boot() {
  const cfgRes = await fetch('/api/config');
  CONFIG = await cfgRes.json();
  $('#supportLink').href = `mailto:${CONFIG.email}?subject=${encodeURIComponent('Order ' + orderId)}`;

  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
  if (!res.ok) {
    $('#main').querySelector('.page-head').hidden = true;
    $('#notFound').hidden = false;
    return;
  }
  const { order } = await res.json();
  document.title = `${order.status === 'paid' ? 'Thank you' : 'Order'} — ${CONFIG.name}`;
  $('#orderRef').textContent = `#${order.id.slice(0, 8).toUpperCase()}`;

  const paid = order.status === 'paid';
  const cancelled = params.get('cancelled') === '1';
  const errored = params.get('error');

  if (paid) {
    $('#statusEyebrow').textContent = params.get('new') === '1' ? 'Payment received' : 'Order complete';
    $('#statusTitle').textContent = params.get('new') === '1' ? 'You\'re good. Take the files.' : 'Your order is complete.';
    $('#statusCopy').textContent = `Licensed to ${order.buyer.name}. Download each file below — the license is available for every track.`;
  } else if (cancelled) {
    $('#statusEyebrow').textContent = 'Payment cancelled';
    $('#statusTitle').textContent = 'Nothing was charged.';
    $('#statusCopy').innerHTML = 'Your order is still waiting. <a href="/" style="text-decoration:underline;text-underline-offset:3px">Back to the store</a>';
  } else if (errored) {
    $('#statusEyebrow').textContent = 'Payment issue';
    $('#statusTitle').textContent = 'We could not confirm the payment.';
    $('#statusCopy').textContent = 'If money left your account, send the order number over and it will be reconciled. Nothing is lost.';
  } else {
    $('#statusEyebrow').textContent = 'Awaiting payment';
    $('#statusTitle').textContent = 'This order is not paid yet.';
    $('#statusCopy').textContent = 'Files unlock once the payment provider confirms. Refresh in a moment if you just paid.';
  }

  $('#orderGrid').hidden = false;
  renderItems(order, paid);
  renderReceipt(order);
}

function renderItems(order, paid) {
  if (!order.downloads.length) {
    $('#items').innerHTML = `<div class="notice">Files will appear here once payment is confirmed.</div>`;
    return;
  }
  const orderArt = (title) => `<div class="art-type" style="--art-bg:#d9c8a4;color:#2a2118;font-size:9px;padding:4px">${esc(title.slice(0, 24))}</div>`;

  $('#items').innerHTML = order.downloads
    .map(
      (d, i) => `<div class="order-item">
        <div class="order-item-head">
          <div style="display:flex;gap:12px;align-items:center">
            <div style="width:40px;height:40px;position:relative;overflow:hidden">${orderArt(d.title)}</div>
            <div><h3>${esc(d.title)}</h3><div class="mono">${esc(d.tier)}</div></div>
          </div>
          ${d.licenseUrl ? `<a class="btn small" href="${esc(d.licenseUrl)}" target="_blank" rel="noopener">License</a>` : ''}
        </div>
        <div class="order-item-body">
          ${d.files
            .map(
              (f) => `<div class="dl-row">
                <span class="dl-name">${
                  f.kind === 'mp3'
                    ? 'MP3 · 320 kbps'
                    : f.kind === 'wav'
                    ? 'WAV · 24-bit master'
                    : f.kind === 'archive'
                    ? (d.kind === 'plugin' ? 'Plugin · archive' : 'Kit · ZIP / RAR')
                    : 'Trackout stems · archive'
                }</span>
                <a class="btn small accent" href="${esc(f.url)}" download>Download</a>
              </div>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');
}

function renderReceipt(order) {
  const rows = order.items
    .map(
      (i) => `<div class="summary-line"><span>${esc(i.title)}<br><span style="color:var(--muted);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase">${esc(i.tierName)} · ${esc(i.licenseNo)}</span></span><span>${money(i.amount)}</span></div>`
    )
    .join('');
  $('#receipt').innerHTML = `${rows}
    <div class="summary-total"><span class="eyebrow">Total</span><strong>${money(order.total)}</strong></div>
    <div style="margin-top:14px;display:grid;gap:6px">
      <div class="summary-line"><span style="color:var(--muted)">Status</span><span class="status-pill ${order.status === 'paid' ? 'paid' : 'pending'}">${esc(order.status)}</span></div>
      <div class="summary-line"><span style="color:var(--muted)">Date</span><span>${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</span></div>
      <div class="summary-line"><span style="color:var(--muted)">Method</span><span>${esc(order.provider)}</span></div>
      <div class="summary-line" style="border-bottom:0"><span style="color:var(--muted)">Email</span><span style="text-align:right;word-break:break-all">${esc(order.buyer.email)}</span></div>
    </div>`;
}

boot();
