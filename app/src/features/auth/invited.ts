import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

/** Has the current user redeemed an invite code? Advisory UX only — RLS on the
 *  user-data tables remains the real wall. */
export function useInvited() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ["invited", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase.rpc("is_invited", { uid: userId! });
      if (error) throw error;
      return z.boolean().parse(data);
    },
  });
}

export const invitedQueryKey = (userId: string) => ["invited", userId] as const;
