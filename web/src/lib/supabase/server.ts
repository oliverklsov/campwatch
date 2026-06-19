import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSbClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/** Per-request client bound to the user's session (RLS enforced). */
export function createClient() {
  const store = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: (cs: { name: string; value: string; options: CookieOptions }[]) => {
          try {
            cs.forEach(({ name, value, options }) => store.set(name, value, options));
          } catch {
            /* called from a Server Component — middleware refreshes sessions */
          }
        },
      },
    }
  );
}

/** Service-role client for the poller. Bypasses RLS — server only. */
export function createServiceClient() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}
