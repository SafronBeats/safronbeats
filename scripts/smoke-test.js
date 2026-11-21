'use strict';

/** Crawls the public pages and checks every local asset + API endpoint. */

const BASE = process.env.BASE || 'http://localhost:3000';

const PAGES = ['/', '/kits', '/plugins', '/about', '/licensing', '/checkout', '/admin'];

async function get(url) {
  const res = await fetch(url, { redirect: 'manual' });
  return { status: res.status, text: await res.text(), type: res.headers.get('content-type') || '' };
}

(async () => {
  const problems = [];
  const assets = new Set();

  for (const page of PAGES) {
    const r = await get(BASE + page);
    if (r.status !== 200) problems.push(`${page} → HTTP ${r.status}`);
    const matches = [...r.text.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]);
    matches.forEach((m) => assets.add(m));
    console.log(`${r.status}  ${page}  (${matches.length} local refs)`);
  }

  const api = [
    '/api/config',
    '/api/beats',
    '/api/admin/session',
  ];
  for (const url of api) {
    const res = await fetch(BASE + url);
    const ok = res.status === 200;
    if (!ok) problems.push(`${url} → HTTP ${res.status}`);
    const body = await res.text();
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      problems.push(`${url} did not return JSON`);
    }
    console.log(`${res.status}  ${url}  ${parsed ? 'json ok' : 'not json'}`);
  }

  let checked = 0;
  for (const asset of assets) {
    const res = await fetch(BASE + asset, { method: 'GET' });
    checked += 1;
    if (res.status >= 400) problems.push(`${asset} → HTTP ${res.status}`);
  }
  console.log(`\n${checked} assets checked`);

  if (problems.length) {
    console.log('\nPROBLEMS:');
    problems.forEach((p) => console.log('  ✗ ' + p));
    process.exit(1);
  }
  console.log('No broken references.');
})();
