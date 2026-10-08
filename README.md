# Aglow

A premium remake of the classic Christmas Tree Light Up puzzle. Turn the wires, light the tree.
Live at https://aglow.lukeghanna.com

![Aglow, a lit Christmas tree in the fireside scene](.github/screenshot.webp)

```bash
npm install
npm run dev     # local dev server
npm test        # unit tests (Vitest)
npm run e2e     # browser smoke tests (Playwright)
npm run build   # typecheck + production build
```

Design spec: `docs/superpowers/specs/2026-09-29-aglow-design.md`

## Radio admin

Luke's Christmas Jazz and Christmas Classics stations are managed at `/admin` (a Cloudflare Worker on `/api/*` plus the R2 bucket `aglow-music`; see spec section 7).

- **Sign-in:** `/admin` signs in with Google. Only the accounts in `ADMIN_EMAILS` get the editor; any other account sees "Not authorized".
- **Run it locally:** copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill in a random `AUTH_SECRET`, then `npm run dev:full` and open `http://localhost:8787/admin`. Local sign-in is fake (`AUTH_MODE=fake`): set the `aglow_fake_as` cookie (or add `?as=<email>` to `/api/auth/google`) to an address in `ADMIN_EMAILS`.
- **Deploy:** `npm run deploy` (see Accounts below for what it checks first).
- **After a deploy,** check that the admin is protected: signed out, `curl -i https://aglow.lukeghanna.com/api/admin/stations` must answer 401, not 503 (`AUTH_SECRET` missing).
- **Uploads that were never saved** stay in R2. They are harmless (no station refers to them); delete them in the Cloudflare dashboard if you want the space back.
- A saved change is live in the game within about a minute. Files removed from a station may stay cached at the edge for up to a week.
