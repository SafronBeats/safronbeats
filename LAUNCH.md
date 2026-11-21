# Launch checklist

Work top to bottom. Nothing here needs code changes.

## 1. Content

- [ ] Admin → Catalog → **Remove demo beats** (drops the three placeholder beats plus the demo kit and plugin)
- [ ] Upload your real beats: MP3 preview + WAV + stems for each, cover art, prices
- [ ] Upload any kits and plugins (type + price + archive)
- [ ] Check every card on `/`, `/kits`, `/plugins` loads audio and shows the right price

## 2. Secrets

Generate a real admin password (do not ship `safron`):

```bash
node -e "console.log(require('crypto').randomBytes(9).toString('base64url'))"
```

Set in the host's environment:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | the password you just generated |
| `STORE_URL` | `https://yourdomain.com` — exact, no trailing slash |
| `NODE_ENV` | `production` |
| `PAYPAL_MODE` | `live` |
| `PAYPAL_CLIENT_ID` / `PAYPAL_SECRET` | live app credentials |
| `CONTACT_EMAIL` | where buyer replies should land |

`STORE_URL` matters: it is what PayPal sends the buyer back to. If it is wrong
or missing behind a proxy, payments complete but the buyer lands on the wrong
host and the order never unlocks.

## 3. Hosting

The app is a single Node process with two writable paths (`data/`, `uploads/`).
It needs a **persistent disk** — a free tier without one will lose every upload
on redeploy.

- **Render** — `render.yaml` in this repo is a working blueprint. Use the
  *starter* plan (disks are not available on free), 10 GB disk mounted at
  `/var/data`, then add the secrets above.
- **Railway / Fly / VPS** — `Dockerfile` is included. Mount a volume at
  `/app/uploads` and `/app/data`, expose port 3000, set the same env vars.
- Any host that provides Node 18+ and a disk will run `npm ci && node server.js`.

DNS: point the domain's A record (or CNAME if the host gives you one) at the
host, wait for it to resolve, then issue TLS. Do not test PayPal live on http —
PayPal will reject the return URL.

## 4. PayPal

1. developer.paypal.com → Apps & Features → create a **Live** app under your
   business account.
2. Copy the client ID and secret into the host's env vars, `PAYPAL_MODE=live`.
3. Restart the service.
4. Buy one beat yourself at a low price with a real card, confirm the money
   arrives, the order shows **paid** in the admin, and downloads work.
5. Refund that order in the admin, and confirm the money comes back in PayPal.

There are no webhooks to register — capture happens on the buyer's return.

## 5. After it is live

- [ ] `https://yourdomain.com/health` returns `{"ok":true,...}`
- [ ] Admin login works over https and the cookie is Secure
- [ ] One real purchase end to end, including the license document
- [ ] `robots.txt` / search console if you care about indexing
- [ ] Back up `data/db.json` and `uploads/` — that is your entire shop. Copy them
      somewhere off the server on a schedule (host cron + `rclone`, or a nightly
      `tar` to object storage).

## 6. Know the failure modes

- **Uploads disappear** → the disk is not mounted at the path you set in
  `UPLOAD_DIR`.
- **PayPal returns to localhost** → `STORE_URL` unset or wrong.
- **Order stuck pending** → the buyer closed the tab before returning; the admin
  Orders tab has **Mark paid** to reconcile manually.
- **"No WAV uploaded"** at checkout → that beat is missing its WAV; either upload
  it or the tier stays disabled, by design.
