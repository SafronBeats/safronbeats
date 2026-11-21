'use strict';

require('dotenv').config();

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const db = require('./lib/db');
const licenses = require('./lib/licenses');
const paypal = require('./lib/paypal');
const stripe = require('./lib/stripe');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = db.UPLOAD_DIR;
const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');

for (const d of [UPLOAD_DIR, TMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

const STORE = {
  name: process.env.STORE_NAME || 'SAFRONBEATS',
  tagline: process.env.STORE_TAGLINE || 'Beats that carry a record.',
  currency: (process.env.STORE_CURRENCY || 'USD').toUpperCase(),
  email: process.env.CONTACT_EMAIL || 'safronbeats@gmail.com',
  instagram: process.env.INSTAGRAM_URL || '',
  youtube: process.env.YOUTUBE_URL || '',
  adminPassword: process.env.ADMIN_PASSWORD || 'safron',
  producer: process.env.PRODUCER_NAME || 'SAFRONBEATS',
};

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  next();
});

app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: '1h' }));

app.get('/health', (req, res) => {
  const dbx = db.load();
  res.json({ ok: true, beats: dbx.beats.length, orders: dbx.orders.length, uptime: Math.round(process.uptime()) });
});

/* Absolute base URL for payment return links. Set STORE_URL in production so
   provider redirects never pick up an internal hostname from a proxy. */
function storeOrigin(req) {
  const fixed = process.env.STORE_URL;
  if (fixed) return String(fixed).replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const AUDIO_EXT = new Set(['.mp3', '.wav']);
const ARCHIVE_EXT = new Set(['.zip', '.rar']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function extOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function safeBase(name) {
  return path
    .basename(String(name || 'file'))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function adminSecret() {
  return db.load().meta.secret || 'fallback-secret';
}

function signAdmin(expiresAt) {
  const payload = String(expiresAt);
  const sig = crypto.createHmac('sha256', adminSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

function verifyAdmin(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', adminSecret()).update(payload).digest('hex');
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

function isAdmin(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return verifyAdmin(cookies.sb_admin);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
    return res.redirect('/admin');
  }
  next();
}

let loginAttempts = { count: 0, windowStart: Date.now() };

function money(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function publicBeat(b, { includeUnpublished = false } = {}) {
  if (!b.published && !includeUnpublished) return null;
  const prices = {};
  for (const t of licenses.TIERS) prices[t.key] = licenses.priceFor(b, t.key);
  const kind = b.kind === 'kit' || b.kind === 'plugin' ? b.kind : 'beat';
  const single = Number(b.prices?.single) || 0;
  return {
    id: b.id,
    kind,
    slug: b.slug,
    title: b.title,
    genre: b.genre || '',
    tags: b.tags || [],
    bpm: b.bpm || null,
    key: b.key || '',
    mood: b.mood || '',
    description: b.description || '',
    duration: b.duration || null,
    format: b.format || '',
    cover: b.cover ? `/media/cover/${b.id}` : null,
    preview: b.mp3 ? `/media/preview/${b.id}` : null,
    has: { mp3: !!b.mp3, wav: !!b.wav, stems: !!b.stems, archive: !!b.stems },
    prices,
    price: kind === 'beat' ? null : single,
    exclusiveSold: !!b.exclusiveSold,
    published: !!b.published,
    demo: !!b.demo,
    createdAt: b.createdAt,
    plays: b.plays || 0,
    sales: b.sales || 0,
  };
}

function storeConfig() {
  return {
    name: STORE.name,
    tagline: STORE.tagline,
    currency: STORE.currency,
    email: STORE.email,
    instagram: STORE.instagram,
    youtube: STORE.youtube,
    producer: STORE.producer,
    providers: {
      paypal: paypal.configured(),
      stripe: stripe.configured(),
      demo: !paypal.configured() && !stripe.configured(),
    },
    paypalMode: paypal.envName(),
    tiers: licenses.PUBLIC_TIERS,
  };
}

/* ------------------------------------------------------------------ */
/* uploads                                                             */
/* ------------------------------------------------------------------ */

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeBase(file.originalname)}`),
  }),
  limits: { fileSize: 1024 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => {
    const ext = extOf(file.originalname);
    const field = file.fieldname;
    const allowed = field === 'cover' ? IMAGE_EXT : field === 'stems' ? ARCHIVE_EXT : AUDIO_EXT;
    if (!allowed.has(ext)) {
      return cb(new Error(`Unsupported file type for ${field}: ${ext || 'unknown'}`));
    }
    cb(null, true);
  },
});

const beatUpload = upload.fields([
  { name: 'mp3', maxCount: 1 },
  { name: 'wav', maxCount: 1 },
  { name: 'stems', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

function moveInto(beatId, tmpFile, kind) {
  if (!tmpFile) return null;
  const dir = path.join(UPLOAD_DIR, beatId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = extOf(tmpFile.originalname) || '.bin';
  const dest = path.join(dir, `${kind}${ext}`);
  fs.renameSync(tmpFile.path, dest);
  return path.relative(UPLOAD_DIR, dest).split(path.sep).join('/');
}

function cleanupTmp(files) {
  if (!files) return;
  for (const list of Object.values(files)) {
    for (const f of list) {
      try {
        if (fs.existsSync(f.path)) fs.unlinkSync(f.path);
      } catch (_) {}
    }
  }
}

function removeBeatFiles(beat) {
  const dir = path.join(UPLOAD_DIR, beat.id);
  try {
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.warn('[files] could not remove', dir, err.message);
  }
}

/* ------------------------------------------------------------------ */
/* public API                                                          */
/* ------------------------------------------------------------------ */

app.get('/api/config', (req, res) => {
  res.json(storeConfig());
});

app.get('/api/beats', (req, res) => {
  const dbx = db.load();
  const includeUnpublished = isAdmin(req) && req.query.all !== '0';
  const kindFilter = ['beat', 'kit', 'plugin'].includes(String(req.query.kind || '')) ? String(req.query.kind) : 'beat';
  const beats = dbx.beats
    .filter((b) => (b.kind || 'beat') === kindFilter)
    .map((b) => publicBeat(b, { includeUnpublished }))
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ beats });
});

app.get('/api/beats/:slug', (req, res) => {
  const dbx = db.load();
  const beat = dbx.beats.find((b) => b.slug === req.params.slug || b.id === req.params.slug);
  const pub = beat && publicBeat(beat, { includeUnpublished: isAdmin(req) });
  if (!pub) return res.status(404).json({ error: 'Beat not found' });
  res.json({ beat: pub });
});

app.get('/media/preview/:id', (req, res) => {
  const dbx = db.load();
  const beat = dbx.beats.find((b) => b.id === req.params.id);
  if (!beat || !beat.mp3) return res.status(404).end();
  beat.plays = (beat.plays || 0) + 1;
  db.save();
  res.sendFile(path.join(UPLOAD_DIR, beat.mp3));
});

app.get('/media/cover/:id', (req, res) => {
  const dbx = db.load();
  const beat = dbx.beats.find((b) => b.id === req.params.id);
  if (!beat || !beat.cover) return res.redirect(`/assets/cover-fallback.svg`);
  res.sendFile(path.join(UPLOAD_DIR, beat.cover));
});

/* ------------------------------------------------------------------ */
/* checkout                                                           */
/* ------------------------------------------------------------------ */

function buildOrder(items, buyer, provider) {
  const dbx = db.load();
  const lines = [];
  for (const raw of items) {
    const beat = dbx.beats.find((b) => b.id === raw.beatId || b.slug === raw.beatId);
    if (!beat) throw httpError(400, 'A product in your cart is no longer available.');
    if (!beat.published) throw httpError(400, `"${beat.title}" is not on sale yet.`);
    const kind = beat.kind === 'kit' || beat.kind === 'plugin' ? beat.kind : 'beat';

    if (kind !== 'beat') {
      if (!beat.stems) throw httpError(400, `"${beat.title}" has no download file uploaded yet.`);
      const amount = money(Number(beat.prices?.single) || 0);
      lines.push({
        beatId: beat.id,
        slug: beat.slug,
        title: beat.title,
        kind,
        tier: 'single',
        tierName: kind === 'kit' ? 'Sample kit' : 'Plugin',
        amount,
        files: ['archive'],
        licenseNo: null,
      });
      continue;
    }

    const tier = licenses.TIER_MAP[raw.tier];
    if (!tier) throw httpError(400, 'Unknown license tier.');
    if (beat.exclusiveSold) throw httpError(400, `"${beat.title}" has already been sold exclusively.`);
    if (tier.files.includes('wav') && !beat.wav) {
      throw httpError(400, `"${beat.title}" has no WAV file uploaded yet — choose the Basic lease or ask for the WAV tier to be enabled.`);
    }
    if (tier.files.includes('stems') && !beat.stems) {
      throw httpError(400, `"${beat.title}" has no stems uploaded yet — pick a lower tier or upload stems.`);
    }
    const amount = licenses.priceFor(beat, tier.key);
    lines.push({
      beatId: beat.id,
      slug: beat.slug,
      title: beat.title,
      kind: 'beat',
      tier: tier.key,
      tierName: tier.name,
      amount,
      files: tier.files,
      licenseNo: licenses.licenseNumber(db.id(4)),
    });
  }
  if (!lines.length) throw httpError(400, 'Your cart is empty.');
  const total = money(lines.reduce((s, l) => s + l.amount, 0));
  const order = {
    id: db.id(10),
    items: lines,
    total,
    currency: STORE.currency,
    buyer: {
      name: String(buyer?.name || '').trim().slice(0, 120),
      email: String(buyer?.email || '').trim().slice(0, 160),
      country: String(buyer?.country || '').trim().slice(0, 80),
    },
    provider,
    status: 'pending',
    createdAt: new Date().toISOString(),
  };
  dbx.orders.push(order);
  db.save();
  return order;
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function fulfill(order, extra = {}) {
  if (order.status === 'paid') return order;
  const dbx = db.load();
  const stored = dbx.orders.find((o) => o.id === order.id);
  if (!stored) return order;
  stored.status = 'paid';
  stored.paidAt = new Date().toISOString();
  Object.assign(stored, extra);
  for (const item of stored.items) {
    const beat = dbx.beats.find((b) => b.id === item.beatId);
    if (!beat) continue;
    beat.sales = (beat.sales || 0) + 1;
    if (item.tier === 'exclusive') beat.exclusiveSold = true;
  }
  db.save();
  return stored;
}

app.post('/api/checkout', async (req, res, next) => {
  try {
    const { items, buyer, provider } = req.body || {};
    if (!Array.isArray(items) || !items.length) throw httpError(400, 'Your cart is empty.');
    if (!buyer?.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(buyer.email))) {
      throw httpError(400, 'A valid email address is required — that is where your license and download links go.');
    }
    const chosen = ['paypal', 'stripe', 'demo'].includes(provider) ? provider : 'demo';
    if (chosen === 'paypal' && !paypal.configured()) throw httpError(400, 'PayPal is not configured.');
    if (chosen === 'stripe' && !stripe.configured()) throw httpError(400, 'Card payments are not configured.');

    const order = buildOrder(items, buyer, chosen);
    const origin = storeOrigin(req);
    const summary = order.items.map((i) => `${i.title} (${i.tierName})`).join(', ');

    if (chosen === 'demo') {
      fulfill(order, { providerRef: 'demo', note: 'Preview checkout — no live payment provider configured.' });
      return res.json({ orderId: order.id, redirect: `/order/${order.id}?new=1` });
    }

    if (chosen === 'paypal') {
      const pp = await paypal.createOrder({
        amount: order.total,
        currency: STORE.currency,
        description: `${STORE.name}: ${summary}`,
        returnUrl: `${origin}/checkout/paypal/return?order=${order.id}`,
        cancelUrl: `${origin}/order/${order.id}?cancelled=1`,
        referenceId: order.id,
      });
      order.providerRef = pp.id;
      db.save();
      return res.json({ orderId: order.id, redirect: pp.approveUrl });
    }

    if (chosen === 'stripe') {
      const session = await stripe.createSession({
        items: order.items.map((i) => ({
          amount: i.amount,
          name: `${i.title} — ${i.tierName}`,
          description: `${STORE.name} license · ${i.licenseNo}`,
        })),
        currency: STORE.currency,
        successUrl: `${origin}/checkout/stripe/success?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/order/${order.id}?cancelled=1`,
        orderId: order.id,
        customerEmail: order.buyer.email,
      });
      order.providerRef = session.id;
      db.save();
      return res.json({ orderId: order.id, redirect: session.url });
    }
  } catch (err) {
    next(err);
  }
});

app.get('/checkout/paypal/return', async (req, res) => {
  const orderId = String(req.query.order || '');
  const token = String(req.query.token || '');
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === orderId);
  if (!order) return res.redirect('/?error=order-not-found');
  try {
    const result = await paypal.captureOrder(token);
    if (result.status !== 'COMPLETED') {
      return res.redirect(`/order/${order.id}?cancelled=1`);
    }
    fulfill(order, {
      providerRef: result.captureId || token,
      payerEmail: result.payerEmail || null,
      payerName: result.payerName || null,
    });
    res.redirect(`/order/${order.id}?new=1`);
  } catch (err) {
    console.error('[paypal] capture failed:', err.message);
    res.redirect(`/order/${order.id}?error=capture`);
  }
});

app.get('/checkout/stripe/success', async (req, res) => {
  const orderId = String(req.query.order || '');
  const sessionId = String(req.query.session_id || '');
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === orderId);
  if (!order) return res.redirect('/?error=order-not-found');
  try {
    const session = await stripe.retrieveSession(sessionId);
    if (session.payment_status === 'paid') {
      fulfill(order, { providerRef: session.payment_intent || sessionId, payerEmail: session.customer_email || null });
      return res.redirect(`/order/${order.id}?new=1`);
    }
    res.redirect(`/order/${order.id}?error=unpaid`);
  } catch (err) {
    console.error('[stripe] verify failed:', err.message);
    res.redirect(`/order/${order.id}?error=verify`);
  }
});

app.get('/api/orders/:id', (req, res) => {
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json({
    order: {
      ...order,
      downloads: order.status === 'paid'
        ? order.items.map((item) => ({
            title: item.title,
            tier: item.tierName,
            kind: item.kind || 'beat',
            files: item.files
              .map((kind) => {
                const beat = dbx.beats.find((b) => b.id === item.beatId);
                if (!beat) return null;
                if (kind === 'archive') {
                  return beat.stems ? { kind, url: `/download/${order.id}/${item.beatId}/archive` } : null;
                }
                return beat[kind] ? { kind, url: `/download/${order.id}/${item.beatId}/${kind}` } : null;
              })
              .filter(Boolean),
            licenseUrl: item.tier === 'single' ? null : `/license/${order.id}/${item.beatId}`,
          }))
        : [],
    },
  });
});

app.get('/download/:orderId/:beatId/:kind', (req, res) => {
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === req.params.orderId);
  if (!order || order.status !== 'paid') return res.status(403).send('Payment required.');
  const item = order.items.find((i) => i.beatId === req.params.beatId);
  if (!item) return res.status(404).send('Not part of this order.');
  const kind = req.params.kind;
  if (!item.files.includes(kind)) return res.status(403).send('This purchase does not include that file.');
  const beat = dbx.beats.find((b) => b.id === item.beatId);
  if (!beat) return res.status(404).send('Product removed.');
  const rel = kind === 'archive' ? beat.stems : beat[kind];
  if (!rel) return res.status(404).send('File missing.');
  const abs = path.join(UPLOAD_DIR, rel);
  if (!fs.existsSync(abs)) return res.status(404).send('File missing on disk.');
  const ext = path.extname(abs);
  const name = `${beat.slug}${item.tier === 'single' ? '' : '-' + item.tier}${kind === 'mp3' ? '' : '-' + kind}${ext}`;
  res.download(abs, name);
});

/* printable license */
app.get('/license/:orderId/:beatId', (req, res) => {
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === req.params.orderId);
  if (!order || order.status !== 'paid') return res.status(403).send('Payment required.');
  const item = order.items.find((i) => i.beatId === req.params.beatId);
  if (!item) return res.status(404).send('Not found.');
  const beat = dbx.beats.find((b) => b.id === item.beatId);
  const tier = licenses.TIER_MAP[item.tier];
  if (!tier) return res.redirect(`/order/${order.id}`);
  const text = licenses.contractText({ order, item, beat: beat || { title: item.title }, tier, licenseNo: item.licenseNo });
  const rows = tier.terms.map((t) => `<li>${escapeHtml(t)}</li>`).join('');
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${escapeHtml(item.licenseNo)} — ${escapeHtml(beat?.title || item.title)} license</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box}
  body{margin:0;background:#f4f1ea;color:#111;font:15px/1.6 -apple-system,Segoe UI,Roboto,sans-serif}
  .sheet{max-width:820px;margin:32px auto;background:#fff;padding:56px 60px;border:1px solid #d9d3c6}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1px solid #111;padding-bottom:18px;margin-bottom:28px}
  .brand{font:600 20px/1 Georgia,serif;letter-spacing:.14em}
  .tag{font:11px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.16em;text-transform:uppercase;color:#6b6459;text-align:right}
  h1{font:600 30px/1.15 Georgia,serif;margin:0 0 4px}
  h2{font:600 12px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.18em;text-transform:uppercase;color:#6b6459;margin:28px 0 8px}
  table{width:100%;border-collapse:collapse;margin:6px 0 0}
  td{padding:7px 0;border-bottom:1px solid #ece7dc;vertical-align:top}
  td:first-child{width:190px;color:#6b6459;font-size:13px}
  ul{margin:6px 0 0;padding-left:18px}
  li{margin:4px 0}
  .note{margin-top:30px;padding-top:18px;border-top:1px solid #d9d3c6;font-size:12px;color:#6b6459}
  .sig{display:flex;gap:48px;margin-top:36px}
  .sig div{flex:1;border-top:1px solid #111;padding-top:8px;font-size:12px;color:#6b6459}
  @media print{body{background:#fff}.sheet{border:0;margin:0;padding:32px 40px}}
</style></head><body><div class="sheet">
<header><div class="brand">${escapeHtml(STORE.name)}</div>
<div class="tag">Non-exclusive beat license<br>${escapeHtml(item.licenseNo)}<br>${new Date(order.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div></header>
<h1>${escapeHtml(beat?.title || item.title)}</h1>
<div style="color:#6b6459">${escapeHtml(tier.name)} · ${escapeHtml(STORE.producer)}</div>
<h2>Licensee</h2>
<table><tr><td>Name</td><td>${escapeHtml(order.buyer.name || '—')}</td></tr>
<tr><td>Email</td><td>${escapeHtml(order.buyer.email || '—')}</td></tr>
<tr><td>Order</td><td>${escapeHtml(order.id)}</td></tr>
<tr><td>Paid</td><td>${escapeHtml(order.currency)} ${Number(order.total).toFixed(2)}</td></tr></table>
<h2>Granted rights</h2><ul>${rows}</ul>
<h2>Terms</h2>
<p style="margin:4px 0">The instrumental is licensed, not sold. ${escapeHtml(STORE.producer)} retains authorship and ownership of the original composition and master recording, subject to the rights granted above. This license is non-exclusive, perpetual and worldwide. The Licensee must credit &ldquo;Prod. ${escapeHtml(STORE.producer)}&rdquo; wherever the finished song is published, and may not resell or sublicense the instrumental itself. Exceeding any usage limit requires an upgrade to a higher tier.</p>
<div class="sig"><div>${escapeHtml(STORE.producer)} — Licensor</div><div>${escapeHtml(order.buyer.name || 'Licensee')} — accepted at checkout</div></div>
<div class="note">Licensed files: ${escapeHtml(tier.files.map((f) => f.toUpperCase()).join(', '))}. Files were delivered immediately after payment. Keep this document with your release records. Print or save as PDF.</div>
</div>
<script>if(location.search.includes('print'))window.print()</script>
</body></html>`);
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* admin                                                              */
/* ------------------------------------------------------------------ */

app.post('/api/admin/login', (req, res) => {
  const now = Date.now();
  if (now - loginAttempts.windowStart > 10 * 60 * 1000) loginAttempts = { count: 0, windowStart: now };
  if (loginAttempts.count > 12) {
    return res.status(429).json({ error: 'Too many attempts — wait a minute and try again.' });
  }
  const password = String(req.body?.password || '');
  if (!password || password !== STORE.adminPassword) {
    loginAttempts.count += 1;
    return res.status(401).json({ error: 'Wrong password.' });
  }
  loginAttempts = { count: 0, windowStart: now };
  const expires = Date.now() + 1000 * 60 * 60 * 12;
  const secure = req.secure || String(process.env.STORE_URL || '').startsWith('https://') ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `sb_admin=${encodeURIComponent(signAdmin(expires))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 12}${secure}`
  );
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'sb_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ admin: isAdmin(req), name: STORE.name, defaultPassword: (process.env.ADMIN_PASSWORD || 'safron') === 'safron' });
});

app.get('/api/admin/summary', requireAdmin, (req, res) => {
  const dbx = db.load();
  const paid = dbx.orders.filter((o) => o.status === 'paid');
  res.json({
    beats: dbx.beats.length,
    published: dbx.beats.filter((b) => b.published).length,
    orders: paid.length,
    revenue: money(paid.reduce((s, o) => s + Number(o.total || 0), 0)),
    currency: STORE.currency,
  });
});

app.get('/api/admin/beats', requireAdmin, (req, res) => {
  const dbx = db.load();
  res.json({ beats: dbx.beats.map((b) => publicBeat(b, { includeUnpublished: true })).filter(Boolean) });
});

app.post('/api/admin/beats', requireAdmin, beatUpload, (req, res) => {
  try {
    const body = req.body || {};
    if (!String(body.title || '').trim()) throw httpError(400, 'A beat title is required.');
    const kind = ['beat', 'kit', 'plugin'].includes(String(body.kind)) ? String(body.kind) : 'beat';
    if (kind !== 'beat' && !req.files?.stems?.[0]) {
      throw httpError(400, kind === 'kit' ? 'Upload the kit as a ZIP or RAR — that file is the product.' : 'Upload the plugin as a ZIP or RAR — that file is the product.');
    }
    const beatId = db.id(8);
    const files = req.files || {};
    const beat = {
      id: beatId,
      kind,
      slug: db.uniqueSlug(body.title),
      title: String(body.title).trim().slice(0, 120),
      format: String(body.format || '').slice(0, 60),
      genre: String(body.genre || '').slice(0, 60),
      mood: String(body.mood || '').slice(0, 60),
      key: String(body.key || '').slice(0, 20),
      bpm: body.bpm ? Number(body.bpm) : null,
      duration: body.duration ? Number(body.duration) : null,
      tags: String(body.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10),
      description: String(body.description || '').slice(0, 1200),
      prices: parsePrices(body),
      mp3: moveInto(beatId, files.mp3?.[0], 'preview'),
      wav: moveInto(beatId, files.wav?.[0], 'wav'),
      stems: moveInto(beatId, files.stems?.[0], 'stems'),
      cover: moveInto(beatId, files.cover?.[0], 'cover'),
      published: String(body.published || 'true') !== 'false',
      exclusiveSold: false,
      plays: 0,
      sales: 0,
      createdAt: new Date().toISOString(),
    };
    const dbx = db.load();
    dbx.beats.push(beat);
    db.save();
    res.status(201).json({ beat: publicBeat(beat, { includeUnpublished: true }) });
  } catch (err) {
    cleanupTmp(req.files);
    next(err);
  }
});

app.patch('/api/admin/beats/:id', requireAdmin, beatUpload, (req, res, next) => {
  try {
    const dbx = db.load();
    const beat = dbx.beats.find((b) => b.id === req.params.id);
    if (!beat) throw httpError(404, 'Beat not found');
    const body = req.body || {};
    const files = req.files || {};

    if (body.kind && ['beat', 'kit', 'plugin'].includes(String(body.kind))) {
      beat.kind = String(body.kind);
    }
    if (body.format !== undefined) beat.format = String(body.format).slice(0, 60);

    if (String(body.title || '').trim() && body.title !== beat.title) {
      beat.title = String(body.title).trim().slice(0, 120);
      beat.slug = db.uniqueSlug(beat.title, beat.id);
    }
    for (const field of ['genre', 'mood', 'key', 'description']) {
      if (body[field] !== undefined) beat[field] = String(body[field]).slice(0, field === 'description' ? 1200 : 60);
    }
    if (body.bpm !== undefined) beat.bpm = body.bpm === '' ? null : Number(body.bpm);
    if (body.duration !== undefined && body.duration !== '') beat.duration = Number(body.duration);
    if (body.tags !== undefined) {
      beat.tags = String(body.tags).split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10);
    }
    if (body.prices !== undefined || body.price_basic !== undefined) beat.prices = parsePrices(body);
    if (body.published !== undefined) beat.published = String(body.published) !== 'false';
    if (body.exclusiveSold !== undefined) beat.exclusiveSold = String(body.exclusiveSold) === 'true';

    for (const [field, kind] of [['mp3', 'preview'], ['wav', 'wav'], ['stems', 'stems'], ['cover', 'cover']]) {
      const f = files[field]?.[0];
      if (!f) continue;
      if (beat[field]) {
        try {
          const old = path.join(UPLOAD_DIR, beat[field]);
          if (fs.existsSync(old)) fs.unlinkSync(old);
        } catch (_) {}
      }
      beat[field] = moveInto(beat.id, f, kind);
    }
    db.save();
    res.json({ beat: publicBeat(beat, { includeUnpublished: true }) });
  } catch (err) {
    cleanupTmp(req.files);
    next(err);
  }
});

app.post('/api/admin/beats/:id/unpublish', requireAdmin, (req, res) => {
  const dbx = db.load();
  const beat = dbx.beats.find((b) => b.id === req.params.id);
  if (!beat) return res.status(404).json({ error: 'Beat not found' });
  beat.published = false;
  db.save();
  res.json({ beat: publicBeat(beat, { includeUnpublished: true }) });
});

app.post('/api/admin/beats/:id/publish', requireAdmin, (req, res) => {
  const dbx = db.load();
  const beat = dbx.beats.find((b) => b.id === req.params.id);
  if (!beat) return res.status(404).json({ error: 'Beat not found' });
  beat.published = true;
  db.save();
  res.json({ beat: publicBeat(beat, { includeUnpublished: true }) });
});

app.delete('/api/admin/beats/:id', requireAdmin, (req, res) => {
  const dbx = db.load();
  const idx = dbx.beats.findIndex((b) => b.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Beat not found' });
  const [beat] = dbx.beats.splice(idx, 1);
  removeBeatFiles(beat);
  db.save();
  res.json({ ok: true });
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const dbx = db.load();
  res.json({
    orders: [...dbx.orders].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  });
});

app.post('/api/admin/orders/:id/mark-paid', requireAdmin, (req, res) => {
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  fulfill(order, { providerRef: order.providerRef || 'manual', note: 'Marked paid manually in the admin panel.' });
  res.json({ order });
});

app.post('/api/admin/orders/:id/refund', requireAdmin, (req, res) => {
  const dbx = db.load();
  const order = dbx.orders.find((o) => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.status = 'refunded';
  order.refundedAt = new Date().toISOString();
  db.save();
  res.json({ order });
});

function parsePrices(body) {
  const out = {};
  const keys = [...licenses.TIERS.map((t) => t.key), 'single'];
  for (const key of keys) {
    const candidates = [body[`price_${key}`], body?.prices?.[key]];
    for (const c of candidates) {
      if (c === undefined || c === null || c === '') continue;
      const n = Number(c);
      if (Number.isFinite(n) && n >= 0) out[key] = Math.round(n * 100) / 100;
    }
  }
  return out;
}

app.post('/api/admin/demo/clear', requireAdmin, (req, res) => {
  const dbx = db.load();
  const removed = dbx.beats.filter((b) => b.demo);
  dbx.beats = dbx.beats.filter((b) => !b.demo);
  removed.forEach(removeBeatFiles);
  db.save();
  res.json({ removed: removed.length });
});

/* ------------------------------------------------------------------ */
/* pages                                                              */
/* ------------------------------------------------------------------ */

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));
app.get('/checkout', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'checkout.html')));
app.get('/order/:id', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'order.html')));
app.get('/licensing', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'licensing.html')));
app.get('/kits', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'kits.html')));
app.get('/plugins', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'plugins.html')));
app.get('/about', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'about.html')));

/* errors */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large (1 GB max per file).' : err.message;
    return res.status(400).json({ error: msg });
  }
  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({ error: err.message || 'Something went wrong.' });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, () => {
  const cfg = storeConfig();
  console.log(`\n  ${cfg.name} store  →  http://localhost:${PORT}`);
  console.log(`  Admin panel     →  http://localhost:${PORT}/admin`);
  console.log(
    `  Payments        →  PayPal: ${cfg.providers.paypal ? 'on (' + cfg.paypalMode + ')' : 'off'} · Card/Stripe: ${
      cfg.providers.stripe ? 'on' : 'off'
    }${cfg.providers.demo ? ' · preview/demo checkout active' : ''}`
  );
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`  Admin password  →  "${STORE.adminPassword}" (set ADMIN_PASSWORD in .env to change)`);
  }
  console.log('');
});
