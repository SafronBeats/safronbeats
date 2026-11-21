'use strict';

/**
 * Creates three placeholder beats with real audio so the store can be
 * previewed before any of your own beats are uploaded.
 * Run: npm run seed:demo      Remove: admin panel → "Remove demo beats"
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const db = require('../lib/db');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const TMP = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TMP, { recursive: true });

const DEMOS = [
  {
    title: 'MIDNIGHT SAFFRON',
    genre: 'Trap',
    mood: 'Dark, warm',
    key: 'F# minor',
    bpm: 140,
    tags: ['dark', '808', 'melodic', 'night'],
    chord: [110, 130.81, 164.81, 220],
    seconds: 28,
    trem: 2,
  },
  {
    title: 'SLOW BURN',
    genre: 'R&B',
    mood: 'Smooth, late night',
    key: 'C minor',
    bpm: 92,
    tags: ['rnb', 'soul', 'smooth', 'guitar'],
    chord: [130.81, 155.56, 196.0, 261.63],
    seconds: 26,
    trem: 0.9,
  },
  {
    title: 'CONCRETE GOSPEL',
    genre: 'Hip Hop',
    mood: 'Soulful, triumphant',
    key: 'G minor',
    bpm: 118,
    tags: ['soul', 'sample', 'boom bap', 'gospel'],
    chord: [98, 116.54, 146.83, 196.0],
    seconds: 30,
    trem: 1.4,
  },
];

function synth({ chord, seconds, trem }, out) {
  const [a, b, c, d] = chord;
  const expr = [
    `0.11*sin(2*PI*${a}*t)`,
    `0.07*sin(2*PI*${b}*t)`,
    `0.06*sin(2*PI*${c}*t)`,
    `0.045*sin(2*PI*${d}*t)`,
    `0.05*sin(2*PI*${a / 2}*t)`,
  ].join('+');
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-f', 'lavfi',
      '-i', `aevalsrc=${expr}:s=44100:d=${seconds}`,
      '-af',
      `tremolo=f=${trem}:d=0.35,highpass=f=40,lowpass=f=9000,afade=t=in:st=0:d=2,afade=t=out:st=${seconds - 3}:d=3,volume=1.4`,
      '-b:a', '320k',
      out,
    ],
    { stdio: 'pipe' }
  );
}

function makeWav(mp3, out) {
  execFileSync('ffmpeg', ['-y', '-i', mp3, '-c:a', 'pcm_s16le', '-ar', '44100', out], { stdio: 'pipe' });
}

function makeZip(source, out) {
  const ps = `Compress-Archive -Path '${source.replace(/'/g, "''")}' -DestinationPath '${out.replace(/'/g, "''")}' -Force`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'pipe' });
}

function durationOf(file) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file], {
      stdio: 'pipe',
    }).toString();
    return Math.round(Number(out.trim())) || null;
  } catch {
    return null;
  }
}

const dbx = db.load();
let added = 0;

for (const spec of DEMOS) {
  if (dbx.beats.some((b) => b.title === spec.title && b.demo)) continue;
  const id = db.id(8);
  const dir = path.join(UPLOAD_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const mp3Abs = path.join(dir, 'preview.mp3');
  const wavAbs = path.join(dir, 'wav.wav');
  const zipAbs = path.join(dir, 'stems.zip');

  synth(spec, mp3Abs);
  makeWav(mp3Abs, wavAbs);
  makeZip(wavAbs, zipAbs);

  const beat = {
    id,
    slug: db.uniqueSlug(spec.title),
    title: spec.title,
    genre: spec.genre,
    mood: spec.mood,
    key: spec.key,
    bpm: spec.bpm,
    duration: durationOf(mp3Abs),
    tags: spec.tags,
    description: 'Placeholder beat generated for the store preview. Delete it from the admin panel once your own beats are uploaded.',
    prices: {},
    mp3: path.join(id, 'preview.mp3').split(path.sep).join('/'),
    wav: path.join(id, 'wav.wav').split(path.sep).join('/'),
    stems: path.join(id, 'stems.zip').split(path.sep).join('/'),
    cover: null,
    published: true,
    exclusiveSold: false,
    demo: true,
    plays: 0,
    sales: 0,
    createdAt: new Date(Date.now() - added * 86400000).toISOString(),
  };
  dbx.beats.push(beat);
  added += 1;
  console.log(`  + ${spec.title} (${spec.bpm} BPM, ${spec.key})`);
}

db.save();
console.log(added ? `\nSeeded ${added} demo beat(s).` : '\nDemo beats already present — nothing to do.');
