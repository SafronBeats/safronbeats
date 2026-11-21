'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = process.env.UPLOAD_DIR ? path.resolve(process.env.UPLOAD_DIR) : path.join(ROOT, 'uploads');

const EMPTY = { beats: [], orders: [], meta: {} };

function ensureDirs() {
  for (const d of [DATA_DIR, UPLOAD_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

let cache = null;

function load() {
  ensureDirs();
  if (cache) return cache;
  if (!fs.existsSync(DB_PATH)) {
    cache = JSON.parse(JSON.stringify(EMPTY));
    cache.meta.secret = crypto.randomBytes(32).toString('hex');
    save();
    return cache;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    cache = {
      beats: Array.isArray(raw.beats) ? raw.beats : [],
      orders: Array.isArray(raw.orders) ? raw.orders : [],
      meta: raw.meta || {},
    };
    if (!cache.meta.secret) {
      cache.meta.secret = crypto.randomBytes(32).toString('hex');
      save();
    }
  } catch (err) {
    console.error('[db] could not parse db.json, starting a new database:', err.message);
    cache = JSON.parse(JSON.stringify(EMPTY));
    cache.meta.secret = crypto.randomBytes(32).toString('hex');
    save();
  }
  return cache;
}

function save() {
  if (!cache) return;
  ensureDirs();
  const tmp = `${DB_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function id(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function slugify(s) {
  return String(s || 'beat')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'beat';
}

function uniqueSlug(title, exceptId) {
  const db = load();
  const base = slugify(title);
  let slug = base;
  let n = 2;
  const taken = (s) => db.beats.some((b) => b.slug === s && b.id !== exceptId);
  while (taken(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

module.exports = {
  load,
  save,
  id,
  slugify,
  uniqueSlug,
  ROOT,
  DATA_DIR,
  DB_PATH,
  UPLOAD_DIR,
};
