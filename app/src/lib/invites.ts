import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";

/* Invite management (You → Invites). */

const myInviteSchema = z.object({
  code: z.string(),
  status: z.enum(["unused", "used", "expired"]),
  used_by_handle: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});
export type MyInvite = z.infer<typeof myInviteSchema>;

const invitesKey = ["myInvites"] as const;

export function useMyInvites() {
  return useQuery({
    queryKey: invitesKey,
    queryFn: async (): Promise<MyInvite[]> => {
      const { data, error } = await supabase.rpc("rpc_my_invites");
      if (error) throw error;
      return z.array(myInviteSchema).parse(data);
    },
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("rpc_create_invite");
      if (error) throw error;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: invitesKey }),
  });
}

/** Shareable link that prefills the invite gate after sign-in. */
export function inviteLink(code: string): string {
  return `${window.location.origin}/login?invite=${encodeURIComponent(code)}`;
}

/* Invite-code stash: bridges the share link (?invite=CODE on /login) to the
   /invite gate shown after auth. localStorage, not sessionStorage — the magic
   link opens in a fresh tab, where sessionStorage from the original tab is
   gone. Cross-device redemption is covered separately by embedding the code
   in the auth redirect URL (see LoginPage). */

const STASH_KEY = "reel.invite";

export function stashInvite(code: string): void {
  try {
    localStorage.setItem(STASH_KEY, code);
  } catch {
    /* storage unavailable */
  }
}

export function readStashedInvite(): string | null {
  try {
    return localStorage.getItem(STASH_KEY);
  } catch {
    return null;
  }
}

export function clearStashedInvite(): void {
  try {
    localStorage.removeItem(STASH_KEY);
  } catch {
    /* ignore */
  }
}
