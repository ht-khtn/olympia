/**
 * Shared auth context helper for Olympia admin server actions.
 * Centralizes the admin context check pattern used across action files.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerAuthContext } from "@/lib/server-auth";
import { perfAction } from "@/lib/olympia/olympia-trace";

/**
 * Get authenticated Olympia admin context.
 * Throws if user is not authenticated or does not have the Olympia admin role.
 */
export async function requireOlympiaAdminContext(): Promise<{
  supabase: SupabaseClient;
  appUserId: string;
}> {
  return await perfAction("[perf][action] requireOlympiaAdminContext", async () => {
    const { supabase, authUid } = await getServerAuthContext();
    if (!authUid) throw new Error("FORBIDDEN_OLYMPIA_ADMIN");

    const olympia = supabase.schema("olympia");
    const { data, error } = await perfAction(
      "[perf][action] supabase.user_roles.role",
      async () => {
        return await olympia
          .from("user_roles")
          .select("role")
          .eq("user_id", authUid)
          .eq("role", "admin")
          .maybeSingle();
      }
    );
    if (error || !data) {
      throw new Error("FORBIDDEN_OLYMPIA_ADMIN");
    }

    return { supabase, appUserId: authUid };
  });
}
