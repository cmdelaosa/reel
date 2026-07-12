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
    .upsert({ tmdb_id: 3999001, kind: "tv", name: "RLS Test Show" }, { onConflict: "tmdb_id" })
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

    // Now invite B (service-role) so the remaining checks isolate RLS, not the gate.
    await admin.from("invites").insert({ code: `RLS-B-${bId.slice(0, 8)}`, used_by: bId });
    const bClient = asUser((await passwordToken(B_EMAIL, B_PASSWORD)).token);

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
    // Best-effort cleanup so reruns are clean.
    await admin.from("library_entries").delete().eq("user_id", a.id).eq("title_id", titleId);
    await admin.from("invites").delete().eq("used_by", bId);
    await admin.from("titles").delete().eq("id", titleId);
    await admin.auth.admin.deleteUser(bId);
  }
});
