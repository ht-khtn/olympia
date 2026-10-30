import { NextResponse } from "next/server";
import { getServerAuthContext } from "@/lib/server-auth";

type SessionResponse = {
  user: { id: string } | null;
  displayName?: string | null;
  isAdmin?: boolean;
  isParticipant?: boolean;
  hasOlympiaAccess?: boolean;
  roles?: string[];
  error?: string;
};

type ProfileRow = {
  display_name: string | null;
};

type RoleRow = {
  role: string;
};

type ParticipantRow = {
  is_active: boolean;
  contestant_code: string | null;
};

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, authUid } = await getServerAuthContext();
    if (!authUid) {
      return NextResponse.json({ user: null } satisfies SessionResponse, {
        headers: noStoreHeaders,
      });
    }

    const olympia = supabase.schema("olympia");
    const [
      { data: profile, error: profileError },
      { data: roleRows, error: rolesError },
      { data: participant, error: participantError },
    ] = await Promise.all([
      olympia.from("profiles").select("display_name").eq("user_id", authUid).maybeSingle(),
      olympia.from("user_roles").select("role").eq("user_id", authUid),
      olympia
        .from("participants")
        .select("is_active, contestant_code")
        .eq("user_id", authUid)
        .maybeSingle(),
    ]);

    const queryError = profileError ?? rolesError ?? participantError;
    if (queryError) {
      return NextResponse.json(
        { user: { id: authUid }, error: queryError.message } satisfies SessionResponse,
        { headers: noStoreHeaders }
      );
    }

    const roles = (Array.isArray(roleRows) ? (roleRows as RoleRow[]) : []).map((row) => row.role);
    const isAdmin = roles.includes("admin");
    const participantRow = participant as ParticipantRow | null;
    const isParticipant = Boolean(participantRow?.is_active);

    return NextResponse.json(
      {
        user: { id: authUid },
        displayName: (profile as ProfileRow | null)?.display_name ?? null,
        isAdmin,
        isParticipant,
        hasOlympiaAccess: isAdmin || isParticipant,
        roles,
      } satisfies SessionResponse,
      { headers: noStoreHeaders }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json(
      { user: null, error: message } satisfies SessionResponse,
      { headers: noStoreHeaders }
    );
  }
}
