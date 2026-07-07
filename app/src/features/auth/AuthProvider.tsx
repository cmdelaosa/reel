import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { profileRowSchema, type ProfileRow } from "@/lib/schemas";

/* Session + profile context. Session tracks supabase-js auth state; the profile
   row is a TanStack query keyed by user id (created by the DB signup trigger,
   so it exists as soon as the user does). */

interface AuthCtx {
  /** undefined = still restoring from storage; null = signed out. */
  session: Session | null | undefined;
  /** undefined = loading/no session; the row exists for every auth user. */
  profile: ProfileRow | undefined;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  session: undefined,
  profile: undefined,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const { data: profile } = useQuery({
    queryKey: ["profile", userId],
    enabled: Boolean(userId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId!)
        .single();
      if (error) throw error;
      return profileRowSchema.parse(data);
    },
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // reset every cached query on sign-out
  };

  return <Ctx.Provider value={{ session, profile, signOut }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(Ctx);
