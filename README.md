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

- **Run it locally:** copy `.dev.vars.example` to `.dev.vars` (git-ignored) and fill in a password and a random `SESSION_SECRET`, then `npm run build && npx wrangler dev` and open `/admin`.
- **Deploy:** `npm run deploy` (typecheck, tests and build, then `wrangler deploy`).
- **Secrets:** set once with `npx wrangler secret put ADMIN_PASSWORD` and `npx wrangler secret put SESSION_SECRET`. Never commit them. Changing either signs every admin out.
- **After a deploy,** check that admin is configured. A same-origin request with an empty body must answer 401 (wrong or missing password), not 503 (a secret is missing):

  ```bash
  curl -i -X POST https://aglow.lukeghanna.com/api/admin/login -H 'Origin: https://aglow.lukeghanna.com'
  ```

- **Uploads that were never saved** stay in R2. They are harmless (no station refers to them); delete them in the Cloudflare dashboard if you want the space back.
- A saved change is live in the game within about a minute. Files removed from a station may stay cached at the edge for up to a week.
