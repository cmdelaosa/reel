import { createClient } from "@supabase/supabase-js";

/* Single browser Supabase client. Auth/RLS gate every request, so the
   publishable (anon) key is safe to ship to the client. Real values live in
   app/.env.local (gitignored); see app/.env.example. */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "Missing Supabase config: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY " +
      "in app/.env.local (copy app/.env.example).",
  );
}

export const supabase = createClient(url, anonKey);
