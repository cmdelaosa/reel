import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* RLS regression — the authorization boundary is entirely Postgres RLS, so this
   proves the two properties nothing else guards:
     1. Cross-tenant isolation: an invited user B cannot read, update or delete
        an invited user A's rows.
     2. Invite gate (migration 0027): an authenticated but UN-invited user
        cannot write user-data rows at all.

   Runs in the nightly/dispatch e2e job (local Supabase stack). Needs the
   service-role key to create + invite the second user deterministically.

   Env (CI sets these; defaults target the local stack):
     E2E_SUPABASE_URL        default http://127.0.0.1:54321
     E2E_ANON_KEY            anon/publishable key
     E2E_SERVICE_ROLE_KEY    service-role key (admin ops + seeding)
     E2E_EMAIL / E2E_PASSWORD  the seeded invited user A */

const URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.E2E_ANON_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const SERVICE = process.env.E2E_SERVICE_ROLE_KEY ?? "";
const A_EMAIL = process.env.E2E_EMAIL ?? "cmo@example.com";
const A_PASSWORD = process.env.E2E_PASSWORD ?? "password123";
const B_EMAIL = "rls-b@example.com";
const B_PASSWORD = "password123";

/** A client authenticated as the given access token (RLS applies as that user). */
function asUser(token: string): SupabaseClient {
  return createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function passwordToken(email: string, password: string): Promise<{ token: string; id: string }> {
  const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  expect(res.ok, `password grant for ${email}`).toBeTruthy();
  const j = await res.json();
  return { token: j.access_token as string, id: j.user.id as string };
}

test("RLS: cross-tenant isolation + invite gate", async () => {
  expect(SERVICE, "E2E_SERVICE_ROLE_KEY must be set for the RLS test").not.toEqual("");
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

  // — User A: the seeded, invited user (can write). —
  const a = await passwordToken(A_EMAIL, A_PASSWORD);

  // — User B: create fresh, then INVITE it so B holds the authenticated role and
  //   RLS is the only thing standing between B and A's data. —
  const { data: created, error: cErr } = await admin.auth.admin.createUser({
    email: B_EMAIL,
    password: B_PASSWORD,
    email_confirm: true,
  });
  expect(cErr, `create B: ${cErr?.message}`).toBeNull();
  const bId = created.user!.id;

  // A shared title to write against (public metadata, service-role write).
  const { data: title, error: tErr } = await admin
    .from("titles")
    .upsert({ tmdb_id: 3999001, kind: "tv", name: "RLS Test Show" }, { onConflict: "kind,tmdb_id" })
    .select("id")
    .single();
  expect(tErr, `seed title: ${tErr?.message}`).toBeNull();
  const titleId = title!.id as string;

  // Clean slate for A's row (previous run).
  await admin.from("library_entries").delete().eq("user_id", a.id).eq("title_id", titleId);

  try {
    // A (invited) writes its own row → allowed.
    const aClient = asUser(a.token);
    const { error: aInsErr } = await aClient
      .from("library_entries")
      .insert({ user_id: a.id, title_id: titleId, followed: true, stopped: false });
    expect(aInsErr, `A insert should succeed: ${aInsErr?.message}`).toBeNull();

    // ── Invite gate (0027): B is NOT invited yet → its own write is rejected. ──
    const bUninvited = asUser((await passwordToken(B_EMAIL, B_PASSWORD)).token);
    const { error: bGateErr } = await bUninvited
      .from("library_entries")
      .insert({ user_id: bId, title_id: titleId, followed: true, stopped: false });
    expect(bGateErr, "un-invited B must NOT be able to insert").not.toBeNull();

    // Now invite B, so that the remaining checks isolate RLS rather than the gate.
    //
    // B redeems a code for real, rather than a column being poked. Since 0062 the
    // pass is profiles.invited_at, and only redeem_invite() (security definer) can
    // seal it: the service role holds no DML on invites or profiles, and B itself
    // is held off by profiles_protect_invited_at. The old line here wrote
    // invites.used_by with the service role — which the grants refused and the
    // new is_invited() would ignore anyway — so B silently stayed un-invited and
    // every isolation check below passed for the wrong reason: B turned away as
    // un-invited, never as the wrong tenant. Hence the two guards after this.
    //
    // Only an invited user may create a code, so it has to come from A, and
    // redeeming a code friends redeemer and inviter. Friends can read each other's
    // library_entries ("friends read"), which is exactly what this test asserts
    // they cannot — so the friendship is torn down before any check runs.
    //
    // A reusable spare is preferred over a fresh code: nothing may DELETE from
    // invites (no grant, either role), so a run that dies between insert and
    // redeem would otherwise leak an unused code toward A's cap of 10.
    const { data: spare } = await aClient
      .from("invites")
      .select("code")
      .eq("created_by", a.id)
      .is("used_by", null)
      .eq("multi_use", false)
      .limit(1);
    let bCode = spare?.[0]?.code as string | undefined;
    if (!bCode) {
      bCode = `RLS-B-${bId.slice(0, 8)}`;
      const { error: cInvErr } = await aClient.from("invites").insert({
        code: bCode,
        created_by: a.id,
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });
      expect(cInvErr, `A creates B's code: ${cInvErr?.message}`).toBeNull();
    }

    const { error: redeemErr } = await asUser((await passwordToken(B_EMAIL, B_PASSWORD)).token)
      .rpc("redeem_invite", { p_code: bCode });
    expect(redeemErr, `B redeems: ${redeemErr?.message}`).toBeNull();

    // Undo the friendship redemption just created (service role: the only one
    // holding DELETE on friendships regardless of who the participants are).
    await admin.from("friendships").delete().or(`a.eq.${bId},b.eq.${bId}`);

    const bClient = asUser((await passwordToken(B_EMAIL, B_PASSWORD)).token);

    // Guard the guards. Un-invited or still friends, and every check below is
    // vacuous — passing on a rule other than the one under test.
    const { data: bInvited } = await bClient.rpc("is_invited", { uid: bId });
    expect(bInvited, "B must be invited, or the isolation checks prove nothing").toBe(true);
    const { data: stillFriends } = await admin.rpc("is_friend", { u1: a.id, u2: bId });
    expect(stillFriends, "A and B must be strangers, or 'friends read' grants the access").toBe(false);

    // ── Cross-tenant READ: B cannot see A's rows. ──
    const { data: bReadsA } = await bClient.from("library_entries").select("*").eq("user_id", a.id);
    expect(bReadsA ?? [], "B must not read A's library_entries").toHaveLength(0);

    // ── Cross-tenant UPDATE: B cannot modify A's row (0 rows match under RLS). ──
    const { data: bUpd } = await bClient
      .from("library_entries")
      .update({ followed: false })
      .eq("user_id", a.id)
      .eq("title_id", titleId)
      .select();
    expect(bUpd ?? [], "B's update must affect 0 of A's rows").toHaveLength(0);

    // ── Cross-tenant DELETE: same. ──
    const { data: bDel } = await bClient
      .from("library_entries")
      .delete()
      .eq("user_id", a.id)
      .eq("title_id", titleId)
      .select();
    expect(bDel ?? [], "B's delete must affect 0 of A's rows").toHaveLength(0);

    // A's row survived B's attempts (checked with the service role).
    const { data: survived } = await admin
      .from("library_entries")
      .select("followed")
      .eq("user_id", a.id)
      .eq("title_id", titleId)
      .single();
    expect(survived?.followed, "A's row must be intact").toBe(true);
  } finally {
    // Best-effort cleanup so reruns are clean. Not B's invite row: no role holds
    // DELETE on invites, so that line only ever looked like cleanup. Redeemed, it
    // no longer counts against A's cap, and deleting the user takes the rest.
    await admin.from("library_entries").delete().eq("user_id", a.id).eq("title_id", titleId);
    await admin.from("friendships").delete().or(`a.eq.${bId},b.eq.${bId}`);
    await admin.from("titles").delete().eq("id", titleId);
    await admin.auth.admin.deleteUser(bId);
  }
});
