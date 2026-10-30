import { getServerAuthContext } from "@/lib/server-auth";

export type OlympiaParticipant = {
  user_id: string;
  contestant_code: string | null;
  is_active: boolean;
};

export type OlympiaRoleSummary =
  | "olympia-admin"
  | "olympia-player"
  | "olympia-mc"
  | "olympia-guest";

export const getOlympiaParticipant = async (): Promise<OlympiaParticipant | null> => {
  const { supabase, authUid } = await getServerAuthContext();
  if (!authUid) return null;

  const { data, error } = await supabase
    .schema("olympia")
    .from("participants")
    .select("user_id, contestant_code, is_active")
    .eq("user_id", authUid)
    .maybeSingle();

  if (error || !data) return null;
  return data as OlympiaParticipant;
};

export async function ensureOlympiaAdminAccess() {
  const { supabase, authUid } = await getServerAuthContext();
  if (!authUid) throw new Error("FORBIDDEN_OLYMPIA_ADMIN");

  const { data, error } = await supabase
    .schema("olympia")
    .from("user_roles")
    .select("role")
    .eq("user_id", authUid)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) throw new Error("FORBIDDEN_OLYMPIA_ADMIN");
  return data;
}

export async function summarizeOlympiaRole(): Promise<OlympiaRoleSummary> {
  const { supabase, authUid } = await getServerAuthContext();
  if (!authUid) return "olympia-guest";

  const { data: adminRole } = await supabase
    .schema("olympia")
    .from("user_roles")
    .select("role")
    .eq("user_id", authUid)
    .eq("role", "admin")
    .maybeSingle();
  if (adminRole) return "olympia-admin";

  const { data: participant } = await supabase
    .schema("olympia")
    .from("participants")
    .select("user_id, contestant_code, is_active")
    .eq("user_id", authUid)
    .eq("is_active", true)
    .maybeSingle();

  if (participant?.contestant_code) return "olympia-player";
  return "olympia-guest";
}
