import { createContext, useContext, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { profileRowSchema, type ProfileRow } from "@/lib/schemas";
import { getSettings } from "@/lib/settings";

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
    supabase.auth.getSession().then(({ data }) => {
      // Dev-only shortcut: with no session, sign straight into a seeded account
      // instead of the magic-link flow. Inert in production (import.meta.env.DEV)
      // and unless VITE_DEV_AUTOLOGIN_EMAIL is set (local .env.local, gitignored).
      const autoEmail = import.meta.env.VITE_DEV_AUTOLOGIN_EMAIL as string | undefined;
      if (!data.session && import.meta.env.DEV && autoEmail) {
        supabase.auth
          .signInWithPassword({
            email: autoEmail,
            password: (import.meta.env.VITE_DEV_AUTOLOGIN_PASSWORD as string | undefined) ?? "password123",
          })
          .then(({ error }) => {
            if (error) setSession(null); // fall back to the login UI
          });
        return; // onAuthStateChange sets the session once sign-in resolves
      }
      setSession(data.session);
    });
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

  /* El país, del navegador a la fila del perfil.
   *
   * Vive en localStorage (lib/settings) porque quien lo lee en cada pantalla es
   * el cliente: decide los proveedores y la zona horaria de las horas de
   * emisión. Pero desde 0071 hay un lector que NO es el navegador — el cron de
   * avisos, que necesita saber en qué país mirar la fecha de estreno de una
   * película para no avisar a un alemán de que algo llega hoy a los cines
   * españoles. Y `profiles.country` no lo escribía nadie: existía desde 0001 y
   * llevaba vacío desde entonces.
   *
   * Se sincroniza aquí, y no en las dos pantallas donde se elige el país, por
   * dos razones: es un solo sitio en vez de dos que puedan separarse, y además
   * rellena la columna de quien lo eligió antes de que esto existiera — la
   * próxima vez que abra la app.
   *
   * Silencioso a propósito: si la escritura falla, el cron cae a ES (el
   * mercado desde el que se mira esta app) y todo lo demás sigue funcionando.
   * No hay nada que enseñarle a nadie por esto. */
  const profileCountry = profile?.country;
  useEffect(() => {
    if (!userId || profile === undefined) return;
    const local = getSettings().country;
    if (!local || local === profileCountry) return;
    void supabase.from("profiles").update({ country: local }).eq("id", userId)
      .then(() => queryClient.invalidateQueries({ queryKey: ["profile", userId] }), () => {});
  }, [userId, profile, profileCountry, queryClient]);

  const signOut = async () => {
    await supabase.auth.signOut();
    queryClient.clear(); // reset every cached query on sign-out
  };

  return <Ctx.Provider value={{ session, profile, signOut }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(Ctx);
