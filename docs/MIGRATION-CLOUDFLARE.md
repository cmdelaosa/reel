# Migration runbook — Vercel → Cloudflare Workers + reel-app.com

Decided 2026-07-20. Reel moves entirely to Cloudflare: hosting on **Workers +
static assets**, domain **`reel-app.com`** on Cloudflare Registrar. Vercel gave
us nothing the app uses — no serverless functions, no image optimization, no
analytics; its only artifact was the SPA rewrite in `app/vercel.json`, which is
one line of `wrangler.jsonc`. The domain also unblocks login SMTP (Supabase's
built-in email is capped at 2/hour; raising it requires Resend, which requires
a verified domain).

**Sequencing decision:** migrate onto `*.workers.dev` first, buy the domain
after. Friends keep using `reel-track.vercel.app` untouched until the cutover;
Supabase auth config changes only once.

## Pre-flight audit (done 2026-07-20 — why this is safe)

| Checked | Result |
| --- | --- |
| Vercel serverless functions / `api/` | None — backend is 100% Supabase |
| `vercel.json` contents | SPA rewrite only; replaced by `assets.not_found_handling` |
| Build-time env vars | Three: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_AUTH=true` (see phase 2 step 1) |
| Secrets leaking into the client bundle | None — audited the deployed JS for `sb_secret_`, `service_role`, JWT secret and Postgres URLs |
| Edge-function CORS | `Access-Control-Allow-Origin: *` everywhere — any origin works |
| Auth redirects (`emailRedirectTo`, invite links) | Built from `window.location.origin` — domain-agnostic |
| Hardcoded URLs in `index.html` / `public/` | None |
| `@vercel/*` packages | None |
| CI (`check.yml`) and e2e (`e2e.yml`) | Run against local stack — unaffected |
| `wrangler.jsonc` | Validated with `wrangler deploy --dry-run` |

Phases 1–3 touch **nothing in production**. The only shared-infra change before
the cutover is *adding* one entry to Supabase Redirect URLs (additive,
harmless). All risk is concentrated in phase 4, which has its own checklist.

## Phase 1 — repo (done, 362ca59)

- [x] `app/wrangler.jsonc` — static-assets-only Worker (no `main`), name `reel`,
      `not_found_handling: "single-page-application"`.
- [x] `wrangler` as devDependency; `app/.wrangler/` gitignored.
- [x] Committed and pushed. CI green; production re-verified after the push
      (200, `index-18rdc5gt.js` = 842 KB — the real bundle, unchanged).

**Validated locally with `wrangler dev` against a real build**, so the config is
known-good before Cloudflare ever runs it:

| Check | Result |
| --- | --- |
| `/` | 200, `text/html` |
| `/friends/stats`, `/calendar`, `/login`, `/show/1399`, `?tab=compare`, unknown paths | 200 + index.html on all — SPA fallback works |
| `/assets/index-*.js` | 200, 841 KB, `text/javascript` |
| `/favicon.svg`, `/logos/*.svg` | 200, `image/svg+xml` |
| `supabase.co` inlined in bundle | Yes — confirms the build-var mechanism |

If a Cloudflare build ever misbehaves, the wrangler config is not the suspect —
look at Build Variables first.

### Response headers: neutral migration, plus one improvement

Compared Vercel's live headers against the Worker's. Both default to
`Cache-Control: public, max-age=0, must-revalidate` on every file, so the move
is header-neutral — nothing to regress.

Both also leave the same thing on the table: Vite content-hashes everything
under `/assets/` (17 files — js, css, woff2), so the filename is already the
cache key and revalidating it on every visit is wasted. `app/public/_headers`
now caches that prefix `immutable` for a year. Verified locally:

| Path | Cache-Control |
| --- | --- |
| `/assets/index-*.js` | `public, max-age=31536000, immutable` |
| `/` (index.html) | `public, max-age=0, must-revalidate` — deploys land at once |
| `/favicon.svg`, `/logos/*` | `public, max-age=0, must-revalidate` — stable names |

Scoped deliberately to `/assets/`: those are the only fingerprinted files, so
nothing with a stable name can get pinned in a browser cache for a year. The
`_headers` file is not served (requests for it hit the SPA fallback and get
index.html). This is inert on Vercel — it ignores the file — so it changes
nothing until the cutover.

## Phase 2 — Cloudflare project (human, dashboard)

1. Env vars — **resolved 2026-07-20, no dashboard archaeology needed**. The
   Vercel project carries ~17 vars, but only three are `VITE_`-prefixed and
   therefore only three reach a Vite build. Verified against the deployed
   bundle: its baked Supabase URL and anon key are byte-identical to
   `app/.env.local`, and the Google button renders live on `/login`, which
   proves `VITE_GOOGLE_AUTH=true`. **Copy these three from `app/.env.local`**
   (`VITE_GOOGLE_AUTH` is marked Sensitive in Vercel and can't be read back
   there anyway):

   | Build Variable | Source |
   | --- | --- |
   | `VITE_SUPABASE_URL` | `app/.env.local` — matches prod |
   | `VITE_SUPABASE_ANON_KEY` | `app/.env.local` — matches prod |
   | `VITE_GOOGLE_AUTH` | `true` |

   **Do NOT carry over the rest.** The `NEXT_PUBLIC_*`, `POSTGRES_*` and
   `SUPABASE_*` vars come from Vercel's Supabase integration (Next.js-shaped;
   this is a Vite app) and are dead weight in a static build. Several are
   crown jewels — `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely, plus
   `POSTGRES_PASSWORD` and `SUPABASE_JWT_SECRET`. They were **not** leaking
   into the client (audited: the only `POSTGRES` hits in the bundle are
   supabase-js's `POSTGRES_CHANGES` enum), but a static-asset build has no use
   for them and shouldn't hold them. Leaving them behind is a net security win;
   consider deleting them from Vercel once phase 5 lands.
2. Cloudflare dashboard → **Workers & Pages → Create → Connect a repository**.
   Install the Cloudflare GitHub App on the repo when prompted.
3. Project settings:
   - **Worker name**: `reel` — MUST match `name` in `wrangler.jsonc` or builds fail.
   - **Root directory**: `app`
   - **Build command**: `npm run check && npm run build`
     (eslint + vitest gate the deploy — stricter than Vercel, which only ran tsc).
   - **Deploy command**: `npx wrangler deploy` (default).
4. **Settings → Build → Build Variables and Secrets** (⚠️ NOT "Variables &
   Secrets" — that's runtime; Vite inlines at build time). All three from
   step 1: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_AUTH`.
   Omitting the last one doesn't fail the build — it silently drops the Google
   button and locks out everyone who signed up that way.
5. Optional: build watch paths → `app/**` so docs-only pushes don't trigger builds.
6. Push (or retry build) → note the `https://reel.<account>.workers.dev` URL.

**Known failure mode:** if the build vars are missing/misplaced, the build still
goes green and serves a blank app (vendor-only bundle, ~30 KB JS). Verify by
bundle size (~800+ KB), never by the green check.

## Phase 3 — verify on workers.dev (DONE, 2026-07-21)

Live at `https://reel.cmdelaosa.workers.dev`. The first build shipped a
vendor-only bundle (336 KB, blank page) because the build variables hadn't been
added yet — the predicted failure, and it went green. After adding the three
vars and re-running the build:

| Check | Result |
| --- | --- |
| Bundle | 842,677 B — matches production's 842,674 B |
| `supabase.co` baked in / `Missing Supabase config` | 4 hits / 0 hits |
| Google button | renders on `/login` (`VITE_GOOGLE_AUTH` arrived) |
| Deep links `/friends/stats` `/calendar` `/login` `/show/1399` | 200 on hard reload |
| `/assets/*` | `max-age=31536000, immutable` |
| `/` | `max-age=0, must-revalidate` |
| Console errors | none |

Remaining before cutover: sign in end-to-end (magic link + Google) from the
workers.dev URL, which needs its Redirect URL added in Supabase.

### Original checklist

1. Supabase dashboard → Authentication → **URL Configuration → Redirect URLs**:
   add `https://reel.<account>.workers.dev/**`. Do NOT touch Site URL.
2. Verify on the workers.dev URL:
   - [ ] Bundle is real (~800+ KB JS, not vendor-only).
   - [ ] Deep link with hard reload (e.g. `/friends/stats`) returns the app,
         not 404 — proves the SPA fallback.
   - [ ] Magic-link login round-trips back to workers.dev.
   - [ ] **Google button is present** on `/login` (proves `VITE_GOOGLE_AUTH`
         made it into the build) and completes a sign-in.
   - [ ] TMDB posters load; no console/network errors.
   - [ ] A push to main auto-deploys; a branch push produces a preview URL.

## Phase 4 — buy the domain + cutover

Order matters; each step is verifiable before the next.

**Steps 1–3 are DONE and verified (2026-07-22).** The domain is registered on
Cloudflare nameservers, attached to the Worker, and `https://reel-app.com`
serves the real app (842,677 B bundle — byte-identical to workers.dev — with
Supabase config baked in and deep links answering 200). The `www` redirect is
live and correct on every shape that matters:

| Request | Result |
| --- | --- |
| `https://www.reel-app.com` | 301 → `https://reel-app.com/` |
| `https://www.reel-app.com/x` | 301 → `https://reel-app.com/x` |
| `https://www.reel-app.com/login?invite=TEST123` | 301 → same path **and query** |

A bare `/` briefly returned 522 right after deploying the rule — that is the
rule still propagating across the edge, not a misconfiguration (522 = Cloudflare
reached the `100::` placeholder because no rule intercepted yet). It cleared on
its own within a minute.

**Nothing so far touches friends** — they are still on
`reel-track.vercel.app`. The remaining steps (4 onward) are the ones that do.

1. **Buy** `reel-app.com` — Cloudflare → Domain Registration ($10.46/yr at cost,
   registration and renewal alike). Zone is created automatically. Click the
   ICANN verification email or the domain is suspended after ~15 days.

   *Name decided 2026-07-21 after surveying the alternatives.* `reelapp.com`
   (no hyphen) is registered by someone else and currently serves nothing —
   worth knowing, since anyone typing the name without the hyphen lands there,
   and its owner can point it anywhere later. That risk is identical for any
   `reelapp.*` we could have bought, so it did not decide anything. `.com` won
   over `.xyz` on email reputation, which matters because this domain exists to
   send magic links; the hyphen costs nothing technically
   (`noreply@mail.reel-app.com` is unaffected) and only shows up when saying
   the name aloud. Rejected: `.win` (cheap but abuse-adjacent TLD, and email
   deliverability is the one thing that cannot fail here) and `.uk` (Nominet
   requires a UK address for service from non-UK registrants).
2. **Attach domain to the Worker**: Worker → Settings → Domains & Routes →
   Custom Domain → `reel-app.com`. DNS + cert are automatic (this is the payoff
   of registrar + host in one place: no A/CNAME plumbing, no gray-cloud rules).
3. **www** — two steps, and the first is easy to miss:

   a. **DNS → Records → Add record**: type `AAAA`, name `www`, address `100::`
      (Cloudflare's documented placeholder for redirect-only hostnames),
      **Proxied (orange cloud)**. Without a proxied record `www` doesn't
      resolve at all and the redirect rule never fires — redirect rules only
      run on hostnames Cloudflare proxies. Orange cloud is correct here
      because the origin *is* Cloudflare (the Worker); the gray-cloud advice
      only applied to the abandoned Vercel-origin plan.

   b. **Rules → Overview → Create rule → Redirect Rule**: match with a
      wildcard pattern `https://www.reel-app.com/*`, target
      `https://reel-app.com/${1}` (dynamic — note `${1}`, not `$1`), status
      301, and enable **Preserve query string** so `?invite=CODE` survives.

   Keeps a single canonical origin.
4. **Resend**: Domains → Add → `mail.reel-app.com` (subdomain keeps root email
   untouched) → add the MX/SPF/DKIM records it lists into the same Cloudflare
   zone (DMARC optional but nice) → Verify green. Then API Keys → create
   `re_...` (shown once).
5. **Supabase SMTP**: Auth → Emails/SMTP → host `smtp.resend.com`, port `465`,
   user `resend`, password = API key, sender `noreply@mail.reel-app.com`.
   Then Auth → Rate Limits → emails/hour to 100+.
6. **Supabase URLs**: Site URL → `https://reel-app.com`. Redirect URLs: add
   `https://reel-app.com/**`; KEEP the vercel.app and workers.dev entries for
   now (magic links already sent must stay valid).
7. **Edge-function secrets** (alerts digest skips email silently without them):
   ```bash
   supabase secrets set RESEND_API_KEY=re_... RESEND_FROM="Reel <alerts@mail.reel-app.com>"
   ```
8. **Vercel becomes a redirect**: replace `app/vercel.json` contents with
   ```json
   {
     "redirects": [
       { "source": "/(.*)", "destination": "https://reel-app.com/$1", "permanent": true }
     ]
   }
   ```
   Redirects run before the filesystem, and query strings (`?invite=CODE`) are
   preserved automatically — old bookmarks and circulating invite links land on
   the new domain. Vercel keeps auto-building on push; harmless.
9. **Verify the cutover**:
   - [ ] `https://reel-app.com` serves the app, cert valid.
   - [ ] `https://www.reel-app.com/x?y=1` → 301 → apex, query intact.
   - [ ] `https://reel-track.vercel.app/login?invite=TEST` → 308 →
         `https://reel-app.com/login?invite=TEST`.
   - [ ] Magic-link login **to a non-team address** (proves custom SMTP).
   - [ ] **Google sign-in works from the new domain.**
   - [ ] Manual `alerts` invoke sends a real email from `alerts@mail.reel-app.com`.
10. **Docs sweep** (Claude): update Vercel/URL references in `ARCHITECTURE.md`
    (hosting row), `DEPLOY.md` (section 6 + SMTP notes), `DETAIL-PERFORMANCE.md`
    (deploy command + alias), `DESIGN.md:101`, `PLAN.md:101`; remove
    `VERCEL_OIDC_TOKEN` from `.env.local` files and delete `.vercel/`.

**Google OAuth needs no Google Cloud Console change.** Supabase owns the OAuth
redirect URI (`https://<ref>.supabase.co/auth/v1/callback`), which the domain
move doesn't touch; the app URL is governed by Supabase's Redirect URLs
allowlist, already covered in step 6. Verify with a real Google sign-in anyway
(step 9) rather than trusting the reasoning.

## Phase 5 — decommission (weeks later, no hurry)

When redirect traffic on reel-track.vercel.app is ~zero: delete the Vercel
project, drop `app/vercel.json`, remove the old entries from Supabase Redirect
URLs.

## Rollback

- Phases 1–3: nothing to roll back — production never changed.
- Phase 4: revert Site URL to `https://reel-track.vercel.app`, `git revert` the
  vercel.json redirect commit (Vercel redeploys the app automatically), and the
  old origin is fully restored. The Worker and domain can stay up harmlessly
  while retrying.
