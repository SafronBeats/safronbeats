# SAFRON BEATS — beat store

A self-hosted beat store with the same leasing model BeatStars uses: tiered
non-exclusive leases (MP3 → WAV → trackouts/stems → unlimited) plus a one-time
exclusive, instant delivery, and a license document generated per sale.

You upload beats yourself from `/admin`. Nothing is hard-coded — prices, files,
titles and terms are all yours.

## Run it

```bash
npm install
cp .env.example .env      # then edit .env (admin password, PayPal keys)
npm run seed:demo         # optional: 3 placeholder beats with real audio
npm start
```

- Store: http://localhost:3000
- Studio: http://localhost:3000/admin — default password `safron`

Change `ADMIN_PASSWORD` in `.env` before you go live.

## Verifying it works

```bash
npm run test:payments   # 21 offline checks on the PayPal/Stripe request shapes
npm run test:smoke      # crawls every page and asset, checks the API
```

The payment tests run without keys or network: they stub fetch and assert the
order intent, amounts, currency, return URLs, capture parsing and that card data
never leaves the server. Real sandbox transactions still need sandbox keys.

There is one manual path worth walking before launch: buy a beat in preview
mode, open the order page, download each file, and open the license document.
Screenshots of that flow live in `preview/`.

## Uploading

Admin → **Upload a beat**. Pick the product type first:

- **Beat** — sold as licenses (Basic → Exclusive), delivered as MP3/WAV/stems
- **Sample kit** — sold as a single download, delivered as its ZIP or RAR
- **Plugin** — sold as a single download, delivered as its ZIP or RAR

Required for a beat: title and an MP3 preview (that is what the store streams).
For a kit or plugin: title, price and the product archive. Optional everywhere:
cover art and a preview loop.

| File | Beats | Kits / plugins |
|---|---|---|
| `preview.mp3` (320 kbps) | Required — streams on the store | Optional audition loop |
| `wav` | Unlocks Premium and above | — |
| `stems.zip` / `.rar` | Unlocks Trackout and above | The product itself |
| cover image | Replaces the generated typographic cover | Same |

Files are stored under `uploads/<beatId>/`. Limits: 1 GB per file, 8 files per
upload. Tiers whose files are missing are automatically disabled at checkout,
so nothing can be sold that has not been delivered.

Brand artwork lives in `public/assets/safron-logo.png` (transparent PNG, pulled
from the Bandcamp page and keyed off its black background). Replacing that one
file updates the header, footer and admin login. A true vector or larger export
will hold up better at print sizes — keep roughly the same aspect ratio.

## Payments

Preview mode is on until you add credentials — checkout completes instantly
without charging, so you can test the whole flow (downloads, license, order
records) before launch.

**PayPal** (redirect flow, Orders v2):

```env
PAYPAL_MODE=sandbox
PAYPAL_CLIENT_ID=...
PAYPAL_SECRET=...
```

Create an app at https://developer.paypal.com/dashboard/applications — sandbox
first, then swap to live keys with `PAYPAL_MODE=live`. The store creates the
order, redirects the buyer to PayPal, captures on return, and only then unlocks
the files.

**Cards via Stripe** (optional):

```env
STRIPE_SECRET_KEY=sk_live_...
```

Both can be enabled at once; the buyer chooses at checkout.

## License model

Tiers, caps and contract language live in `lib/licenses.js`. Each tier defines
delivered files, distribution copies, streams, videos, paid shows, radio and
the exact terms printed into the license. Edit that one file to change your
terms everywhere — storefront, checkout, license documents.

Per-beat price overrides are set in the admin panel. Blank = standard rate.

## Data

- `data/db.json` — beats, orders, admin secret
- `uploads/` — audio, stems archives, covers

Back both up. There is no external database.

## Deploying

Any Node host works (Render, Railway, Fly, a VPS). Requirements:

1. Node 18+
2. Persistent disk for `uploads/` and `data/` — ephemeral filesystems lose
   uploads on restart
3. HTTPS, then set `PAYPAL_MODE=live` and real keys
4. `PORT` is read from the environment

For PayPal live, the return URL is built from the incoming request host, so the
site must be served on its real domain (not behind a rewriting proxy that hides
the host header).

## Before launch checklist

- [ ] Change `ADMIN_PASSWORD`
- [ ] Remove demo beats (Catalog → *Remove demo beats*)
- [ ] Upload your real beats, set prices per beat
- [ ] Add PayPal live keys, run one real low-value test purchase
- [ ] Print one license document and check the name/terms
- [ ] Back up `data/db.json` and `uploads/` somewhere off the server
