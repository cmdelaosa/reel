# Phase 6 — Native + public (outline)

**Not specced yet on purpose.** Detailed commit specs get written when Phase 5 ships and we can
see what actually matters. This outline records intent so earlier phases don't paint us into
corners.

## Intent

1. **Native shell**: evaluate two routes with a 1-week spike each, in this order:
   - **Capacitor** wrapping the existing web app (cheapest; push notifications + app icons may
     be all we truly need natively), vs
   - **Expo rebuild** of the client on the shared `domain/` + `lib/` layers (the original
     DESIGN.md route; higher cost, better feel).
   The spike reports pick the route. `domain/` purity (no DOM imports) is the guardrail earlier
   phases must respect to keep this optionable.
2. **Push notifications**: platform push via the chosen shell; server side reuses the Phase 3
   alerts job (add a `push` channel to `notification_prefs`).
3. **Apple Sign-In** (App Store requirement once Google login ships in a store build).
4. **Store distribution**: EAS or Xcode/Play console; TestFlight + internal track first.
5. **Open sign-up**: waitlist or open registration; moderation basics (report user, block);
   rate limits revisited; privacy policy + ToS pages.
6. **Ops hardening**: Supabase paid tier evaluation, backups, uptime monitoring, Sentry.

## Blockers to resolve before speccing

- Real usage numbers from the friends era (do we need native at all, or is A2HS enough?).
- Push criticality: are email digests (Phase 3) actually satisfying?
- Budget decision for store fees ($99/yr Apple, $25 Google).
