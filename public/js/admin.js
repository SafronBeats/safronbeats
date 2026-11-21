/* SAFRONBEATS — admin */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
let CONFIG = null;
let BEATS = [];
let editingId = null;
const picked = { mp3: null, wav: null, stems: null, cover: null };

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
function toast(msg, bad) {
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}
function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

/* ---------- auth ---------- */

async function checkSession() {
  const res = await fetch('/api/admin/session');
  const data = await res.json();
  if (data.defaultPassword === false) {
    const hint = $('#pwHint');
    if (hint) hint.hidden = true;
  }
  if (data.admin) showApp();
  else showLogin();
}

function showLogin() {
  $('#loginView').hidden = false;
  $('#appView').hidden = true;
  setTimeout(() => $('#pw')?.focus(), 50);
}

async function showApp() {
  $('#loginView').hidden = true;
  $('#appView').hidden = false;
  const cfgRes = await fetch('/api/config');
  CONFIG = await cfgRes.json();
  renderPayStatus();
  await Promise.all([loadStats(), loadBeats(), loadOrders()]);
}

$('#loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  $('#loginBtn').disabled = true;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: $('#pw').value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed');
    await showApp();
  } catch (err) {
    $('#loginErr').textContent = err.message;
  } finally {
    $('#loginBtn').disabled = false;
  }
});

$('#logoutBtn')?.addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.reload();
});

/* ---------- tabs ---------- */

const tabs = $$('.admin-tab');
tabs.forEach((t) =>
  t.addEventListener('click', () => {
    tabs.forEach((x) => x.setAttribute('aria-selected', 'false'));
    t.setAttribute('aria-selected', 'true');
    $$('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== t.dataset.tab));
    if (t.dataset.tab === 'upload' && !editingId) resetForm();
  })
);
$$('[data-goto]').forEach((b) =>
  b.addEventListener('click', () => {
    const tab = tabs.find((t) => t.dataset.tab === b.dataset.goto);
    if (tab) tab.click();
  })
);

function renderPayStatus() {
  const el = $('#payStatus');
  const p = CONFIG.providers || {};
  el.hidden = false;
  if (p.demo) {
    el.innerHTML = `<strong style="color:var(--ink)">Preview mode.</strong> No payment provider is connected, so checkout completes instantly without charging. Add PayPal or Stripe keys to <code>.env</code> to take real money — nothing else needs to change.`;
  } else {
    const bits = [];
    if (p.paypal) bits.push(`PayPal ${CONFIG.paypalMode === 'live' ? 'live' : 'sandbox'}`);
    if (p.stripe) bits.push('Stripe live');
    el.innerHTML = `<strong style="color:var(--ink)">Payments armed:</strong> ${bits.join(' + ')}. Orders are marked paid automatically on return from the provider.`;
  }
}

/* ---------- stats / tables ---------- */

async function loadStats() {
  const res = await fetch('/api/admin/summary');
  if (!res.ok) return;
  const s = await res.json();
  $('#stats').innerHTML = `
    <div class="stat"><b>${s.beats}</b><span>Beats</span></div>
    <div class="stat"><b>${s.published}</b><span>Live</span></div>
    <div class="stat"><b>${s.orders}</b><span>Paid orders</span></div>
    <div class="stat"><b>${money(s.revenue)}</b><span>Revenue</span></div>`;
}

async function loadBeats() {
  const res = await fetch('/api/admin/beats');
  const data = await res.json();
  BEATS = data.beats || [];
  const tbody = $('#beatTable tbody');
  $('#noBeats').hidden = BEATS.length > 0;
  const hasDemo = BEATS.some((b) => b.demo);
  const demoBtn = $('#clearDemo');
  if (demoBtn) demoBtn.hidden = !hasDemo;
  tbody.innerHTML = BEATS.map((b) => {
    const from = Math.min(...Object.values(b.prices || {}).filter((n) => n > 0), Infinity);
    const art = b.cover
      ? `<img src="${esc(b.cover)}" alt="" style="width:100%;height:100%;object-fit:cover">`
      : `<div class="art-type" style="--art-bg:#d9c8a4;color:#2a2118;font-size:7px;padding:2px">${esc((b.title || '').slice(0, 12))}</div>`;
    return `<tr>
      <td><div style="display:flex;gap:10px;align-items:center"><div class="mini-art">${art}</div><div><strong>${esc(b.title)}</strong><div class="mono" style="margin-top:2px">${esc(b.kind || 'beat')} · ${esc(b.slug)}</div></div></div></td>
      <td class="mono">${b.kind === 'beat' ? ([b.bpm && b.bpm + ' bpm', b.key, b.genre].filter(Boolean).map(esc).join(' · ') || '—') : esc(b.format || '—')}</td>
      <td class="mono">${b.kind === 'beat' ? ['mp3', 'wav', 'stems'].map((f) => `<span class="${b.has[f] ? 'tag-ok' : 'tag-no'}">${f.toUpperCase()}</span>`).join(' ') : `<span class="${b.has.archive ? 'tag-ok' : 'tag-no'}">ARCHIVE</span>`}</td>
      <td class="mono">${b.kind === 'beat' ? (Number.isFinite(from) ? money(from) : '—') : b.price ? money(b.price) : '—'}</td>
      <td class="mono">${b.sales || 0}</td>
      <td>${b.exclusiveSold ? '<span class="status-pill" style="border-color:var(--accent);color:var(--accent)">Exclusive sold</span>' : b.published ? '<span class="status-pill paid">Live</span>' : '<span class="status-pill">Draft</span>'}</td>
      <td><div class="row-actions">
        <button class="btn small ghost" data-edit="${b.id}">Edit</button>
        <button class="btn small ghost" data-toggle="${b.id}">${b.published ? 'Unpublish' : 'Publish'}</button>
        <button class="btn small ghost" data-del="${b.id}" style="color:var(--danger)">Delete</button>
      </div></td>
    </tr>`;
  }).join('');

  $$('[data-edit]').forEach((b) => b.addEventListener('click', () => startEdit(b.dataset.edit)));
  $$('[data-toggle]').forEach((b) =>
    b.addEventListener('click', async () => {
      const beat = BEATS.find((x) => x.id === b.dataset.toggle);
      const action = beat?.published ? 'unpublish' : 'publish';
      const res = await fetch(`/api/admin/beats/${b.dataset.toggle}/${action}`, { method: 'POST' });
      if (res.ok) {
        toast(action === 'publish' ? 'Beat is live' : 'Beat hidden from the store');
        loadBeats();
        loadStats();
      } else toast('Could not update', true);
    })
  );
  $$('[data-del]').forEach((b) =>
    b.addEventListener('click', async () => {
      const beat = BEATS.find((x) => x.id === b.dataset.del);
      if (!confirm(`Delete “${beat?.title}” and its uploaded files? This cannot be undone.`)) return;
      const res = await fetch(`/api/admin/beats/${b.dataset.del}`, { method: 'DELETE' });
      if (res.ok) {
        toast('Beat deleted');
        loadBeats();
        loadStats();
      } else toast('Could not delete', true);
    })
  );
}

async function loadOrders() {
  const res = await fetch('/api/admin/orders');
  const data = await res.json();
  const orders = data.orders || [];
  $('#noOrders').hidden = orders.length > 0;
  $('#orderTable tbody').innerHTML = orders
    .map(
      (o) => `<tr>
      <td class="mono">#${esc(o.id.slice(0, 8).toUpperCase())}</td>
      <td>${esc(o.buyer?.name || '—')}<div class="mono" style="margin-top:2px">${esc(o.buyer?.email || '')}</div></td>
      <td class="mono">${o.items.map((i) => `${esc(i.title)} · ${esc(i.tierName)}`).join('<br>')}</td>
      <td class="mono">${money(o.total)}</td>
      <td class="mono">${esc(o.provider || '')}</td>
      <td><span class="status-pill ${o.status === 'paid' ? 'paid' : ''}">${esc(o.status)}</span></td>
      <td class="mono">${new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}</td>
      <td><div class="row-actions">
        ${o.status === 'paid' ? '' : `<button class="btn small ghost" data-paid="${esc(o.id)}">Mark paid</button>`}
        ${o.status === 'paid' ? `<button class="btn small ghost" data-refund="${esc(o.id)}" style="color:var(--danger)">Refund</button>` : ''}
      </div></td>
    </tr>`
    )
    .join('');

  $$('[data-paid]', $('#orderTable')).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Mark this order as paid and unlock its downloads?')) return;
      const res = await fetch(`/api/admin/orders/${b.dataset.paid}/mark-paid`, { method: 'POST' });
      if (res.ok) {
        toast('Order marked paid');
        loadOrders();
        loadStats();
      } else toast('Could not update the order', true);
    })
  );
  $$('[data-refund]', $('#orderTable')).forEach((b) =>
    b.addEventListener('click', async () => {
      if (!confirm('Mark this order refunded? Access to the files is revoked.')) return;
      const res = await fetch(`/api/admin/orders/${b.dataset.refund}/refund`, { method: 'POST' });
      if (res.ok) {
        toast('Order refunded');
        loadOrders();
        loadStats();
      } else toast('Could not refund', true);
    })
  );
}

/* ---------- file picking ---------- */

function setPicked(kind, file) {
  picked[kind] = file || null;
  const meta = $(`[data-file="${kind}"]`);
  const zone = $(`[data-drop="${kind}"]`);
  if (!meta || !zone) return;
  if (file) {
    meta.textContent = `${file.name} · ${fmtBytes(file.size)}`;
    zone.classList.add('has-file');
  } else {
    meta.textContent = '';
    zone.classList.remove('has-file');
  }
}

function describeAccept(kind) {
  return kind === 'cover' ? '.jpg,.jpeg,.png,.webp,.gif' : kind === 'stems' ? '.zip,.rar' : '.mp3,.wav';
}

['mp3', 'wav', 'stems', 'cover'].forEach((kind) => {
  const zone = $(`[data-drop="${kind}"]`);
  const input = $(`#file_${kind}`);
  if (!zone || !input) return;
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('over');
    const f = e.dataTransfer.files?.[0];
    if (!f) return;
    input.files = e.dataTransfer.files;
    handleFile(kind, f);
  });
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) handleFile(kind, f);
  });
});

function handleFile(kind, file) {
  const name = file.name.toLowerCase();
  const ok =
    kind === 'cover'
      ? /\.(jpe?g|png|webp|gif)$/.test(name)
      : kind === 'stems'
      ? /\.(zip|rar)$/.test(name)
      : /\.(mp3|wav)$/.test(name);
  if (!ok) {
    toast(`Wrong file type for ${kind} — expected ${describeAccept(kind)}`, true);
    return;
  }
  if (file.size > 1024 * 1024 * 1024) {
    toast('File is over the 1 GB limit', true);
    return;
  }
  setPicked(kind, file);
  if (kind === 'mp3') readDuration(file);
}

function readDuration(file) {
  const url = URL.createObjectURL(file);
  const probe = new Audio();
  probe.preload = 'metadata';
  probe.src = url;
  probe.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(probe.duration)) {
      $('#duration').value = String(Math.round(probe.duration));
      const meta = $('[data-file="mp3"]');
      if (meta) meta.textContent += ` · ${Math.floor(probe.duration / 60)}:${String(Math.floor(probe.duration % 60)).padStart(2, '0')}`;
    }
    URL.revokeObjectURL(url);
  });
  probe.addEventListener('error', () => URL.revokeObjectURL(url));
}

/* ---------- form ---------- */

function syncKindFields() {
  const kind = $('#kind')?.value || 'beat';
  const isBeat = kind === 'beat';
  const s = $('#singleFields');
  const t = $('#tierFields');
  if (s) s.hidden = isBeat;
  if (t) t.hidden = !isBeat;
  const save = $('#saveBtn');
  if (save && !save.disabled) save.textContent = editingId ? 'Save changes' : isBeat ? 'Publish beat' : `Publish ${kind}`;
  const stemsLabel = $('[data-drop="stems"] strong');
  if (stemsLabel) stemsLabel.textContent = isBeat ? 'Drop ZIP / RAR or click' : 'Drop product ZIP / RAR or click';
  const stemsHint = $('[data-drop="stems"] span');
  if (stemsHint) stemsHint.textContent = isBeat ? 'Unlocks Trackout and above' : 'This file is what the buyer downloads';
}

$('#kind')?.addEventListener('change', syncKindFields);

function resetForm() {
  editingId = null;
  $('#beatForm').reset();
  $('#beatId').value = '';
  $('#duration').value = '';
  $('#published').checked = true;
  $('#kind').value = 'beat';
  $('#format').value = '';
  ['mp3', 'wav', 'stems', 'cover'].forEach((k) => setPicked(k, null));
  syncKindFields();
  $('#formTitle').textContent = 'Upload a product';
  $('#saveBtn').textContent = 'Publish beat';
  $('#cancelEdit').hidden = true;
  $('#formErr').textContent = '';
}

function startEdit(id) {
  const b = BEATS.find((x) => x.id === id);
  if (!b) return;
  editingId = id;
  const tab = tabs.find((t) => t.dataset.tab === 'upload');
  if (tab) tab.click();
  $('#beatId').value = b.id;
  $('#kind').value = b.kind || 'beat';
  $('#format').value = b.format || '';
  $('#price_single').value = b.price || '';
  $('#title').value = b.title || '';
  $('#genre').value = b.genre || '';
  $('#mood').value = b.mood || '';
  $('#bpm').value = b.bpm || '';
  $('#key').value = b.key || '';
  $('#tags').value = (b.tags || []).join(', ');
  $('#description').value = b.description || '';
  $('#published').checked = !!b.published;
  ['basic', 'premium', 'trackout', 'unlimited', 'exclusive'].forEach((k) => {
    const el = $(`#price_${k}`);
    if (el) el.value = b.prices?.[k] ?? '';
  });
  ['mp3', 'wav', 'stems', 'cover'].forEach((k) => {
    setPicked(k, null);
    const meta = $(`[data-file="${k}"]`);
    if (meta && b.has?.[k]) meta.textContent = 'Current file on server — choose a new one to replace';
    if (meta && k === 'cover' && b.cover) meta.textContent = 'Current cover on server — choose a new one to replace';
  });
  $('#formTitle').textContent = 'Edit product';
  $('#saveBtn').textContent = 'Save changes';
  $('#cancelEdit').hidden = false;
  syncKindFields();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#cancelEdit')?.addEventListener('click', resetForm);

$('#clearDemo')?.addEventListener('click', async () => {
  if (!confirm('Remove the placeholder demo beats and their generated audio? Your own uploads are untouched.')) return;
  const res = await fetch('/api/admin/demo/clear', { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    toast(`${data.removed} demo beat${data.removed === 1 ? '' : 's'} removed`);
    await Promise.all([loadBeats(), loadStats()]);
  } else toast('Could not clear demo beats', true);
});

$('#beatForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const err = $('#formErr');
  err.textContent = '';
  const title = $('#title').value.trim();
  const kind = $('#kind').value;
  if (!title) {
    err.textContent = 'A title is required.';
    return;
  }
  if (kind !== 'beat') {
    const existingStems = editingId && BEATS.find((b) => b.id === editingId)?.has?.stems;
    if (!picked.stems && !existingStems) {
      err.textContent = 'Upload the product as a ZIP or RAR — that file is what the buyer downloads.';
      toast('Add the product archive', true);
      return;
    }
  }
  if (kind === 'beat' && !editingId && !picked.mp3) {
    err.textContent = 'An MP3 preview is required — it is what the store streams.';
    toast('Add an MP3 preview', true);
    return;
  }
  const fd = new FormData();
  fd.append('kind', kind);
  ['title', 'genre', 'mood', 'bpm', 'key', 'tags', 'description', 'duration', 'format'].forEach((f) => fd.append(f, $(`#${f}`)?.value || ''));
  fd.append('published', $('#published').checked ? 'true' : 'false');
  if (kind === 'beat') {
    ['basic', 'premium', 'trackout', 'unlimited', 'exclusive'].forEach((k) => {
      const v = $(`#price_${k}`).value.trim();
      if (v !== '') fd.append(`price_${k}`, v);
    });
  } else {
    const v = $('#price_single').value.trim();
    if (v !== '') fd.append('price_single', v);
  }
  ['mp3', 'wav', 'stems', 'cover'].forEach((k) => {
    if (picked[k]) fd.append(k, picked[k]);
  });

  const url = editingId ? `/api/admin/beats/${editingId}` : '/api/admin/beats';
  const method = editingId ? 'PATCH' : 'POST';
  const xhr = new XMLHttpRequest();
  xhr.open(method, url);
  const prog = $('#uploadProgress');
  prog.classList.add('on');
  const fill = $('i', prog);
  $('#saveBtn').disabled = true;
  $('#saveBtn').textContent = 'Uploading…';

  xhr.upload.addEventListener('progress', (ev) => {
    if (ev.lengthComputable) fill.style.width = `${Math.round((ev.loaded / ev.total) * 100)}%`;
  });
  xhr.addEventListener('load', () => {
    $('#saveBtn').disabled = false;
    prog.classList.remove('on');
    fill.style.width = '0%';
    let data = {};
    try {
      data = JSON.parse(xhr.responseText || '{}');
    } catch {}
    if (xhr.status >= 200 && xhr.status < 300) {
      toast(editingId ? 'Beat updated' : 'Beat published');
      resetForm();
      loadBeats();
      loadStats();
      const tab = tabs.find((t) => t.dataset.tab === 'catalog');
      if (tab) tab.click();
    } else {
      $('#saveBtn').textContent = editingId ? 'Save changes' : 'Publish beat';
      err.textContent = data.error || 'Upload failed';
      toast(data.error || 'Upload failed', true);
    }
  });
  xhr.addEventListener('error', () => {
    $('#saveBtn').disabled = false;
    prog.classList.remove('on');
    alert('Network error during upload. Large files on a weak connection can time out.');
  });
  xhr.send(fd);
});

checkSession();
