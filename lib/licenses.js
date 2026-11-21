'use strict';

/**
 * License tiers modelled on the standard BeatStars lease structure:
 * non-exclusive leases that escalate in file delivery and usage caps,
 * plus a one-time exclusive.
 *
 * caps: copies (distribution units), streams, videos, paid shows, radio.
 */

const TIERS = [
  {
    key: 'basic',
    name: 'Basic Lease',
    short: 'MP3',
    files: ['mp3'],
    defaultPrice: 29.95,
    caps: {
      copies: '2,000',
      streams: '100,000',
      videos: '1',
      shows: 'Non-profit performances only',
      radio: '2 stations',
    },
    terms: [
      'Licensed files: untagged MP3 (320 kbps)',
      'Distribute up to 2,000 copies of the finished song',
      'Up to 100,000 online audio streams',
      'One (1) music video',
      'Non-profit live performances only',
      'Radio broadcasting on up to two (2) stations',
    ],
  },
  {
    key: 'premium',
    name: 'Premium Lease',
    short: 'WAV',
    files: ['mp3', 'wav'],
    defaultPrice: 49.95,
    caps: {
      copies: '5,000',
      streams: '500,000',
      videos: '1',
      shows: 'Up to 10 paid performances',
      radio: '5 stations',
    },
    terms: [
      'Licensed files: untagged WAV (24-bit) + MP3 (320 kbps)',
      'Distribute up to 5,000 copies of the finished song',
      'Up to 500,000 online audio streams',
      'One (1) music video',
      'Up to ten (10) paid live performances',
      'Radio broadcasting on up to five (5) stations',
    ],
  },
  {
    key: 'trackout',
    name: 'Trackout Lease',
    short: 'STEMS',
    files: ['mp3', 'wav', 'stems'],
    defaultPrice: 99.95,
    caps: {
      copies: '10,000',
      streams: '1,000,000',
      videos: '2',
      shows: 'Up to 25 paid performances',
      radio: '10 stations',
    },
    terms: [
      'Licensed files: WAV (24-bit) + MP3 (320 kbps) + full trackout stems',
      'Distribute up to 10,000 copies of the finished song',
      'Up to 1,000,000 online audio streams',
      'Two (2) music videos',
      'Up to twenty-five (25) paid live performances',
      'Radio broadcasting on up to ten (10) stations',
    ],
  },
  {
    key: 'unlimited',
    name: 'Unlimited Lease',
    short: 'UNLIMITED',
    files: ['mp3', 'wav', 'stems'],
    defaultPrice: 149.95,
    caps: {
      copies: 'Unlimited',
      streams: 'Unlimited',
      videos: 'Unlimited',
      shows: 'Unlimited paid performances',
      radio: 'Unlimited stations',
    },
    terms: [
      'Licensed files: WAV (24-bit) + MP3 (320 kbps) + full trackout stems',
      'Unlimited distribution of the finished song',
      'Unlimited online audio streams',
      'Unlimited music videos',
      'Unlimited paid live performances',
      'Unlimited radio broadcasting',
    ],
  },
  {
    key: 'exclusive',
    name: 'Exclusive Rights',
    short: 'EXCLUSIVE',
    files: ['mp3', 'wav', 'stems'],
    defaultPrice: 499.0,
    caps: {
      copies: 'Unlimited',
      streams: 'Unlimited',
      videos: 'Unlimited',
      shows: 'Unlimited paid performances',
      radio: 'Unlimited stations',
    },
    terms: [
      'Licensed files: WAV (24-bit) + MP3 (320 kbps) + full trackout stems',
      'Exclusive right to the instrumental — the beat is removed from sale',
      'Unlimited distribution, streams, videos and paid performances',
      'Producer retains authorship and publishing of the composition',
      'Existing non-exclusive licenses remain valid',
    ],
    exclusive: true,
  },
];

const TIER_MAP = Object.fromEntries(TIERS.map((t) => [t.key, t]));

const PUBLIC_TIERS = TIERS.map((t) => ({
  key: t.key,
  name: t.name,
  short: t.short,
  files: t.files,
  caps: t.caps,
  terms: t.terms,
  exclusive: !!t.exclusive,
  defaultPrice: t.defaultPrice,
}));

function priceFor(beat, tierKey) {
  const custom = beat && beat.prices && beat.prices[tierKey];
  const tier = TIER_MAP[tierKey];
  const n = Number(custom);
  if (Number.isFinite(n) && n > 0) return round2(n);
  return tier ? round2(tier.defaultPrice) : 0;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function licenseNumber(seed) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `SB-${stamp}-${String(seed).slice(0, 6).toUpperCase()}`;
}

function contractText({ order, item, beat, tier, licenseNo }) {
  const buyer = order.buyer || {};
  const producer = process.env.PRODUCER_NAME || 'SAFRONBEATS';
  const year = new Date(order.createdAt || Date.now()).getFullYear();
  const lines = [
    `NON-EXCLUSIVE BEAT LICENSE AGREEMENT`,
    ``,
    `License No: ${licenseNo}`,
    `Date: ${new Date(order.createdAt || Date.now()).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
    ``,
    `PRODUCER / LICENSOR`,
    `${producer}`,
    ``,
    `LICENSEE`,
    `${buyer.name || '—'}`,
    `${buyer.email || '—'}`,
    ``,
    `WORK`,
    `"${beat.title}" — ${beat.bpm ? beat.bpm + ' BPM' : ''}${beat.key ? ', ' + beat.key : ''}`,
    ``,
    `LICENSE GRANTED`,
    `${tier.name} (${String(tier.short || '').toLowerCase()})`,
    ``,
    ...tier.terms.map((t) => `• ${t}`),
    ``,
    `GENERAL TERMS`,
    `1. The instrumental is licensed, not sold. ${producer} retains all rights, title and interest in the original composition and master recording, subject to the rights granted here.`,
    `2. This license is non-exclusive. The same instrumental may be licensed to other artists under separate agreements.`,
    `3. The Licensee must credit "${producer}" in the following form wherever the song is published: "Prod. ${producer}".`,
    `4. The Licensee may not resell, sublicense, redistribute or register the instrumental itself as their own work.`,
    `5. The Licensee may monetise the finished song on streaming platforms, in the territory worldwide, for the term of copyright.`,
    `6. Stems, where included, may be used for mixing and mastering the finished song only.`,
    `7. This license begins on the date of purchase and is perpetual, provided the usage limits above are respected.`,
    `8. Exceeding any limit in the tier above requires an upgrade to a higher tier; upgrade pricing is credited against the original purchase.`,
    `9. This agreement is governed by the laws of the Producer's country of residence and constitutes the entire agreement between the parties.`,
    ``,
    `DELIVERY`,
    `Files are delivered immediately after payment: ${tier.files.map((f) => f.toUpperCase()).join(', ')}.`,
    ``,
    `Accepted electronically at checkout by the Licensee.`,
    `${producer}`,
  ];
  return lines.join('\n');
}

module.exports = {
  TIERS,
  PUBLIC_TIERS,
  TIER_MAP,
  priceFor,
  licenseNumber,
  contractText,
};
