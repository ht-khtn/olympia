"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "crypto";
import { z } from "zod";
import { requireOlympiaAdminContext } from "@/lib/olympia/olympia-auth";
import { getServerAuthContext, getServerSupabase } from "@/lib/server-auth";
import {
  encryptCurrentRoomPassword,
  generateRoomPassword,
  hashRoomPassword,
  verifyRoomPassword,
} from "@/lib/olympia/session-credentials";
import { issueOlympiaGrant, revokeOlympiaGrants } from "@/lib/olympia/session-grants";
import {
  isOlympiaPasswordRateLimited,
  recordOlympiaPasswordAttempt,
} from "@/lib/olympia/session-password-rate-limit";
import type { ActionState } from "./match.actions";

function generateJoinCode() {
  return `OLY-${randomBytes(8).toString("base64url").slice(0, 10).toUpperCase()}`;
}

const joinSchema = z.object({
  joinCode: z
    .string()
    .min(4, "Mã tối thiểu 4 ký tự")
    .max(32, "Mã tối đa 32 ký tự")
    .transform((val) => val.trim().toUpperCase()),
  playerPassword: z
    .string()
    .optional()
    .transform((val) => val?.trim() ?? ""),
});

const mcPasswordSchema = z.object({
  joinCode: z
    .string()
    .min(1, "Vui lòng nhập mã phòng")
    .max(20, "Mã phòng quá dài")
    .transform((val) => val.trim().toUpperCase()),
  mcPassword: z
    .string()
    .min(4, "Mật khẩu tối thiểu 4 ký tự")
    .max(64, "Mật khẩu quá dài")
    .transform((val) => val.trim()),
});

const matchIdSchema = z.object({
  matchId: z.string().uuid("Trận không hợp lệ."),
});

const regeneratePasswordSchema = z.object({
  sessionId: z.string().uuid("Session ID không hợp lệ"),
});

export async function lookupJoinCodeAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const { authUid, supabase } = await getServerAuthContext();
    if (!authUid) return { error: "Bạn cần đăng nhập để tham gia phòng." };

    const parsed = joinSchema.safeParse({
      joinCode: formData.get("joinCode"),
      playerPassword: formData.get("playerPassword"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Mã tham gia không hợp lệ." };
    }

    const olympia = supabase.schema("olympia");
    const { data, error } = await olympia
      .from("live_sessions")
      .select(
        "id, status, match_id, question_state, current_round_type, player_password_hash, requires_player_password"
      )
      .eq("join_code", parsed.data.joinCode)
      .maybeSingle();

    if (error) return { error: error.message };
    if (!data) return { error: "Không tìm thấy phòng với mã này." };
    if (data.status === "ended") return { error: "Phòng thi đã kết thúc." };

    const { data: membership, error: membershipError } = await olympia
      .from("match_players")
      .select("id")
      .eq("match_id", data.match_id)
      .eq("participant_id", authUid)
      .maybeSingle();
    if (membershipError || !membership) return { error: "Tài khoản không thuộc phòng thi này." };

    const requiresPassword = data.requires_player_password !== false;
    if (requiresPassword) {
      if (!parsed.data.playerPassword || parsed.data.playerPassword.length === 0) {
        return { error: "Phòng yêu cầu mật khẩu thí sinh." };
      }
      if (await isOlympiaPasswordRateLimited(data.id, "player")) {
        return { error: "Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại." };
      }
      if (!verifyRoomPassword(data.player_password_hash, parsed.data.playerPassword)) {
        await recordOlympiaPasswordAttempt({
          sessionId: data.id,
          scope: "player",
          succeeded: false,
        });
        return { error: "Sai mật khẩu thí sinh." };
      }
      await recordOlympiaPasswordAttempt({ sessionId: data.id, scope: "player", succeeded: true });
    }

    try {
      await issueOlympiaGrant({ sessionId: data.id, scope: "player", userId: authUid });
    } catch (grantError) {
      return { error: grantError instanceof Error ? grantError.message : "Không thể cấp quyền phòng thi." };
    }

    return {
      success:
        `Phòng đang chạy (round: ${data.current_round_type ?? "N/A"}, trạng thái: ${data.question_state}).` as const,
      data: { sessionId: data.id },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Không thể kiểm tra mã tham gia." };
  }
}

export async function verifyMcPasswordAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const parsed = mcPasswordSchema.safeParse({
      joinCode: formData.get("joinCode"),
      mcPassword: formData.get("mcPassword"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Mã phòng hoặc mật khẩu không hợp lệ." };
    }

    const supabase = await getServerSupabase();
    const olympia = supabase.schema("olympia");
    const { data: session, error } = await olympia
      .from("live_sessions")
      .select("id, match_id, mc_password_hash, status")
      .eq("join_code", parsed.data.joinCode)
      .maybeSingle();

    if (error) return { error: error.message };
    if (!session) return { error: "Không tìm thấy phòng với mã này." };

    if (!session.mc_password_hash) {
      return { error: "Phòng chưa cấu hình mật khẩu MC." };
    }

    if (await isOlympiaPasswordRateLimited(session.id, "mc")) {
      return { error: "Bạn đã thử quá nhiều lần. Vui lòng chờ rồi thử lại." };
    }

    if (!verifyRoomPassword(session.mc_password_hash, parsed.data.mcPassword)) {
      await recordOlympiaPasswordAttempt({ sessionId: session.id, scope: "mc", succeeded: false });
      return { error: "Sai mật khẩu MC." };
    }

    await recordOlympiaPasswordAttempt({ sessionId: session.id, scope: "mc", succeeded: true });
    await issueOlympiaGrant({ sessionId: session.id, scope: "mc" });

    return {
      success: session.status === "running"
        ? "Đã mở khóa chế độ xem MC."
        : "Mật khẩu đúng, nhưng phòng chưa chạy. Bạn vẫn có thể xem chế độ chuẩn bị.",
      data: { joinCode: parsed.data.joinCode, matchId: session.match_id },
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Không thể xác thực mật khẩu MC." };
  }
}

export async function openLiveSessionAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const { supabase, appUserId } = await requireOlympiaAdminContext();
    const olympia = supabase.schema("olympia");
    const parsed = matchIdSchema.safeParse({ matchId: formData.get("matchId") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Thiếu thông tin trận." };
    }

    const matchId = parsed.data.matchId;
    const { data: match, error: matchError } = await olympia
      .from("matches")
      .select("id, status")
      .eq("id", matchId)
      .maybeSingle();
    if (matchError) return { error: matchError.message };
    if (!match) return { error: "Không tìm thấy trận." };

    const { data: session, error: sessionError } = await olympia
      .from("live_sessions")
      .select("id, join_code, status")
      .eq("match_id", matchId)
      .maybeSingle();
    if (sessionError) return { error: sessionError.message };

    const playerPasswordPlain = generateRoomPassword();
    const mcPasswordPlain = generateRoomPassword();
    const hashedPlayerPassword = hashRoomPassword(playerPasswordPlain);
    const hashedMcPassword = hashRoomPassword(mcPasswordPlain);
    let activeJoinCode = session?.join_code ?? null;

    if (!session) {
      let inserted = false;
      for (let attempt = 0; attempt < 5 && !inserted; attempt += 1) {
        const joinCode = generateJoinCode();
        const { error } = await olympia.from("live_sessions").insert({
          match_id: matchId,
          join_code: joinCode,
          status: "running",
          created_by: appUserId,
          player_password_hash: hashedPlayerPassword,
          mc_password_hash: hashedMcPassword,
          player_password_ciphertext: encryptCurrentRoomPassword(playerPasswordPlain),
          mc_password_ciphertext: encryptCurrentRoomPassword(mcPasswordPlain),
          requires_player_password: true,
        });
        if (!error) {
          activeJoinCode = joinCode;
          inserted = true;
          break;
        }
        if (error.code !== "23505") return { error: error.message };
      }
      if (!inserted) return { error: "Không thể tạo mã phòng duy nhất." };
    } else {
      const { error } = await olympia
        .from("live_sessions")
        .update({
          status: "running",
          join_code: activeJoinCode,
          question_state: "hidden",
          current_round_id: null,
          current_round_question_id: null,
          timer_deadline: null,
          ended_at: null,
          player_password_hash: hashedPlayerPassword,
          mc_password_hash: hashedMcPassword,
          player_password_ciphertext: encryptCurrentRoomPassword(playerPasswordPlain),
          mc_password_ciphertext: encryptCurrentRoomPassword(mcPasswordPlain),
          requires_player_password: true,
        })
        .eq("id", session.id);
      if (error) return { error: error.message };
    }

    if (match.status !== "live") {
      const { error } = await olympia.from("matches").update({ status: "live" }).eq("id", matchId);
      if (error) return { error: error.message };
    }

    revalidatePath("/olympia/admin/matches");
    revalidatePath("/olympia/admin");
    revalidatePath("/olympia/client");

    return {
      success: `Đã mở phòng. Mã tham gia: ${activeJoinCode ?? "—"}. Mật khẩu thí sinh: ${playerPasswordPlain} Mật khẩu MC: ${mcPasswordPlain}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Không thể mở phòng thi." };
  }
}

export async function getSessionPasswordAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const { supabase } = await requireOlympiaAdminContext();
    const olympia = supabase.schema("olympia");

    const parsed = regeneratePasswordSchema.safeParse({
      sessionId: formData.get("sessionId"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Session ID không hợp lệ." };
    }

    const { data: session, error: sessionError } = await olympia
      .from("live_sessions")
      .select("id, player_password_ciphertext, mc_password_ciphertext")
      .eq("id", parsed.data.sessionId)
      .maybeSingle();
    if (sessionError) return { error: sessionError.message };
    if (!session) return { error: "Không tìm thấy phòng. Vui lòng mở phòng trước." };

    const { decryptCurrentRoomPassword } = await import("@/lib/olympia/session-credentials");
    const playerPassword = decryptCurrentRoomPassword(session.player_password_ciphertext);
    const mcPassword = decryptCurrentRoomPassword(session.mc_password_ciphertext);

    return {
      success: `Mật khẩu thí sinh: ${playerPassword} Mật khẩu MC: ${mcPassword}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Không thể lấy mật khẩu." };
  }
}

export async function regenerateSessionPasswordAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const { supabase } = await requireOlympiaAdminContext();
    const olympia = supabase.schema("olympia");

    const parsed = regeneratePasswordSchema.safeParse({
      sessionId: formData.get("sessionId"),
    });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Session ID không hợp lệ." };
    }

    const { data: session, error: sessionError } = await olympia
      .from("live_sessions")
      .select("id, status")
      .eq("id", parsed.data.sessionId)
      .maybeSingle();

    if (sessionError) return { error: sessionError.message };
    if (!session) return { error: "Không tìm thấy phòng." };

    // Generate new passwords
    const playerPasswordPlain = generateRoomPassword();
    const mcPasswordPlain = generateRoomPassword();
    const hashedPlayerPassword = hashRoomPassword(playerPasswordPlain);
    const hashedMcPassword = hashRoomPassword(mcPasswordPlain);

    // Update session with new passwords
    const { error: updateError } = await olympia
      .from("live_sessions")
      .update({
        player_password_hash: hashedPlayerPassword,
        mc_password_hash: hashedMcPassword,
        player_password_ciphertext: encryptCurrentRoomPassword(playerPasswordPlain),
        mc_password_ciphertext: encryptCurrentRoomPassword(mcPasswordPlain),
      })
      .eq("id", parsed.data.sessionId);

    if (updateError) return { error: updateError.message };

    await revokeOlympiaGrants(parsed.data.sessionId);

    revalidatePath("/olympia/admin/matches");

    return {
      success: `Đã sinh lại mật khẩu. Mật khẩu thí sinh: ${playerPasswordPlain} Mật khẩu MC: ${mcPasswordPlain}`,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Không thể sinh lại mật khẩu." };
  }
}

export async function endLiveSessionAction(
  _: ActionState,
  formData: FormData
): Promise<ActionState> {
  try {
    const { supabase } = await requireOlympiaAdminContext();
    const olympia = supabase.schema("olympia");
    const parsed = matchIdSchema.safeParse({ matchId: formData.get("matchId") });
    if (!parsed.success) {
      return { error: parsed.error.issues[0]?.message ?? "Thiếu thông tin trận." };
    }

    const matchId = parsed.data.matchId;
    const { data: session, error: sessionError } = await olympia
      .from("live_sessions")
      .select("id, status")
      .eq("match_id", matchId)
      .maybeSingle();
    if (sessionError) return { error: sessionError.message };
    if (!session) return { error: "Trận này chưa có phòng live." };
    if (session.status === "ended") {
      return { error: "Phòng đã kết thúc trước đó." };
    }

    const endedAt = new Date().toISOString();

    const [{ error: liveError }, { error: matchError }] = await Promise.all([
      olympia
        .from("live_sessions")
        .update({ status: "ended", ended_at: endedAt })
        .eq("id", session.id),
      olympia.from("matches").update({ status: "finished" }).eq("id", matchId),
    ]);

    if (liveError) return { error: liveError.message };
    if (matchError) return { error: matchError.message };

    await revokeOlympiaGrants(session.id);

    revalidatePath("/olympia/admin/matches");
    revalidatePath("/olympia/admin");
    revalidatePath("/olympia/client");

    return { success: "Đã kết thúc phòng thi." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Không thể kết thúc phòng thi." };
  }
}
