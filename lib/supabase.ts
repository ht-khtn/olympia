import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabasePublicEnv } from "@/configs/env";

let browserClient: SupabaseClient | null = null;

export async function getSupabase(): Promise<SupabaseClient> {
  if (typeof window === "undefined") {
    throw new Error(
      "getSupabase() should only be called client-side. Use getSupabaseServer() on the server."
    );
  }

  if (browserClient) return browserClient;

  const { url, anonKey } = getSupabasePublicEnv();
  browserClient = createBrowserClient(url, anonKey);
  return browserClient;
}

export default getSupabase;
