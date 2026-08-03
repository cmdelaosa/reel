import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, prefFor, type Pref } from "@/lib/notificationPrefs";

/* Most users never touch Settings, so `defaults` — not any stored row — is what
   the notification system actually does for them. It is also duplicated by
   necessity into the SQL triggers and the mailer functions, which cannot import
   this file, so the values are pinned here: changing one without the others is
   a notification sent or dropped in silence. */

const spec = (type: string) => NOTIFICATION_TYPES.find((n) => n.type === type);

describe("defaults", () => {
  it("puts every in-app notification on", () => {
    for (const n of NOTIFICATION_TYPES) expect(n.defaults.inapp).toBe(true);
  });

  it("emails friend requests and nothing else", () => {
    // Mirrored by 0063's notify_friend_request (coalesce(email, true)) and by
    // friend-request-email's `pref?.email ?? true`.
    expect(spec("friend_request")?.defaults.email).toBe(true);
    const others = NOTIFICATION_TYPES.filter((n) => n.type !== "friend_request");
    expect(others.map((n) => n.defaults.email)).toEqual(others.map(() => false));
  });

  it("only offers a channel a producer can actually deliver", () => {
    // An Email chip on a type nothing mails for is the dead switch 0059 removed.
    expect(spec("new_episode")?.channels).toContain("email");
    expect(spec("friend_request")?.channels).toContain("email");
    expect(spec("reaction")?.channels).not.toContain("email");
  });

  it("never defaults a channel on that it doesn't offer", () => {
    for (const n of NOTIFICATION_TYPES) {
      if (!n.channels.includes("email")) expect(n.defaults.email).toBe(false);
    }
  });

  it("has dropped the import toggle", () => {
    expect(spec("import_done")).toBeUndefined();
  });
});

describe("prefFor", () => {
  it("prefers the stored row over the default", () => {
    const stored: Record<string, Pref> = { friend_request: { inapp: false, email: false } };
    expect(prefFor(stored, "friend_request")).toEqual({ inapp: false, email: false });
  });

  it("falls back to the type's own default, not one shared default", () => {
    expect(prefFor({}, "friend_request").email).toBe(true);
    expect(prefFor({}, "new_episode").email).toBe(false);
  });

  it("treats a still-loading query as the defaults", () => {
    expect(prefFor(undefined, "friend_request").email).toBe(true);
  });

  it("leaves a retired type fully on rather than muting it", () => {
    // Dropping a row from NOTIFICATION_TYPES must not turn its notifications
    // off for everyone by accident.
    expect(prefFor({}, "import_done")).toEqual({ inapp: true, email: false });
  });
});
