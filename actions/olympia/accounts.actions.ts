"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { User } from "@supabase/supabase-js";
import { requireOlympiaAdminContext } from "@/lib/olympia/olympia-auth";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

export type AccountActionState = {
  error?: string | null;
  success?: string | null;
  credentials?: {
    email: string;
    password: string;
  } | null;
};

export type AccountDeleteState = {
  error?: string | null;
  success?: string | null;
  deactivated?: boolean;
};

const contestantCodeSchema = z
  .string()
  .trim()
  .max(32, "Mã thí sinh quá dài.")
  .regex(/^[A-Za-z0-9_-]+$/, "Mã thí sinh không hợp lệ.")
  .transform((value) => value.toUpperCase());

const createAccountSchema = z
  .object({
    email: z.string().trim().email("Email không hợp lệ."),
    displayName: z.string().trim().min(1, "Tên hiển thị là bắt buộc.").max(120),
    isParticipant: z.boolean(),
    contestantCode: z.string().trim().optional(),
    isAdmin: z.boolean(),
    password: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (!value.isParticipant && !value.isAdmin) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isParticipant"],
        message: "Tài khoản phải là admin hoặc thí sinh.",
      });
    }
    if (value.isParticipant && !value.contestantCode) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["contestantCode"],
        message: "Mã thí sinh là bắt buộc.",
      });
    }
  });

const updateAccountSchema = z.object({
  userId: z.string().uuid("User ID không hợp lệ."),
  displayName: z.string().trim().min(1, "Tên hiển thị là bắt buộc.").max(120),
  isAdmin: z.boolean(),
  isParticipant: z.boolean(),
  isParticipantActive: z.boolean(),
  contestantCode: z.string().trim().optional(),
});

function formBoolean(value: FormDataEntryValue | null): boolean {
  return value === "true" || value === "on";
}

function errorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

function isDuplicateError(error: unknown): boolean {
  const message = errorMessage(error, "").toLowerCase();
  return message.includes("duplicate") || message.includes("unique") || message.includes("already");
}

const OLYMPIA_EMAIL_DOMAIN = "@olympia.nvh.edu.vn";

function isOlympiaInternalEmail(email: string): boolean {
  return email.toLowerCase().endsWith(OLYMPIA_EMAIL_DOMAIN);
}

const passwordSchema = z.string().min(8, "Mật khẩu phải có ít nhất 8 ký tự.").max(128);
const userIdSchema = z.string().uuid("User ID không hợp lệ.");

async function countRows(
  table: string,
  column: string,
  userId: string,
  olympia: ReturnType<ReturnType<typeof getOlympiaAdminClient>["schema"]>
): Promise<number> {
  const { count, error } = await olympia.from(table).select(column, { count: "exact", head: true }).eq(column, userId);
  if (error) throw error;
  return count ?? 0;
}

export async function resetOlympiaAccountPasswordAction(
  _: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  await requireOlympiaAdminContext();
  const userId = userIdSchema.safeParse(formData.get("userId"));
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!userId.success) return { error: userId.error.issues[0]?.message ?? "User ID không hợp lệ." };
  if (!password.success) return { error: password.error.issues[0]?.message ?? "Mật khẩu không hợp lệ." };

  const admin = getOlympiaAdminClient();
  const { data: authUser, error: authUserError } = await admin.auth.admin.getUserById(userId.data);
  if (authUserError || !authUser.user) return { error: "Tài khoản Auth không tồn tại." };
  const { error } = await admin.auth.admin.updateUserById(userId.data, { password: password.data });
  if (error) return { error: errorMessage(error, "Không thể đặt lại mật khẩu.") };

  revalidatePath("/olympia/admin/accounts");
  return {
    success: "Đã đặt lại mật khẩu. Phiên đăng nhập cũ chưa được xác nhận là đã bị thu hồi.",
    credentials: { email: authUser.user.email ?? "", password: password.data },
  };
}

export async function deleteOlympiaAccountAction(
  _: AccountDeleteState,
  formData: FormData
): Promise<AccountDeleteState> {
  const { appUserId } = await requireOlympiaAdminContext();
  const parsedUserId = userIdSchema.safeParse(formData.get("userId"));
  if (!parsedUserId.success) return { error: parsedUserId.error.issues[0]?.message ?? "User ID không hợp lệ." };
  if (formData.get("confirm") !== "true") return { error: "Cần xác nhận trước khi xóa tài khoản." };
  const userId = parsedUserId.data;
  if (userId === appUserId) return { error: "Không thể xóa tài khoản Admin đang đăng nhập." };

  const admin = getOlympiaAdminClient();
  const olympia = admin.schema("olympia");
  const { data: role, error: roleError } = await olympia
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (roleError) return { error: roleError.message };

  if (role) {
    const { count, error } = await olympia
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) return { error: error.message };
    if ((count ?? 0) <= 1) return { error: "Không thể xóa Admin cuối cùng." };
  }

  try {
    const participantCount = await countRows("participants", "user_id", userId, olympia);
    const matchPlayerCount = participantCount
      ? await countRows("match_players", "participant_id", userId, olympia)
      : 0;
    if (matchPlayerCount > 0) {
      const { error } = await olympia
        .from("participants")
        .update({ is_active: false })
        .eq("user_id", userId);
      if (error) return { error: `Không thể ngừng hoạt động tài khoản: ${error.message}` };
      revalidatePath("/olympia/admin/accounts");
      return {
        success: "Tài khoản đã có lịch sử thi đấu nên được chuyển sang ngừng hoạt động, không xóa dữ liệu.",
        deactivated: true,
      };
    }

    const profileReferences = await Promise.all([
      countRows("tournaments", "created_by", userId, olympia),
      countRows("matches", "host_user_id", userId, olympia),
      countRows("question_sets", "uploaded_by", userId, olympia),
      countRows("question_set_items", "created_by", userId, olympia),
      countRows("live_sessions", "password_generated_by", userId, olympia),
      countRows("live_sessions", "created_by", userId, olympia),
      countRows("session_access_grants", "user_id", userId, olympia),
      countRows("score_changes", "created_by", userId, olympia),
      countRows("score_changes", "reverted_by", userId, olympia),
      countRows("user_roles", "granted_by", userId, olympia),
    ]);
    if (profileReferences.some((count) => count > 0)) {
      if (participantCount > 0) {
        const { error } = await olympia
          .from("participants")
          .update({ is_active: false })
          .eq("user_id", userId);
        if (error) return { error: `Không thể ngừng hoạt động tài khoản: ${error.message}` };
        revalidatePath("/olympia/admin/accounts");
        return {
          success: "Tài khoản có dữ liệu liên quan cần bảo tồn nên được chuyển sang ngừng hoạt động.",
          deactivated: true,
        };
      }
      return { error: "Tài khoản có dữ liệu liên quan cần bảo tồn nên không thể xóa vật lý." };
    }

    const { data: profile, error: profileReadError } = await olympia
      .from("profiles")
      .select("id, email, display_name, avatar_url")
      .eq("id", userId)
      .maybeSingle();
    if (profileReadError) return { error: `Không thể chuẩn bị xóa profile: ${profileReadError.message}` };
    const { data: participant, error: participantReadError } = await olympia
      .from("participants")
      .select("user_id, contestant_code, is_active")
      .eq("user_id", userId)
      .maybeSingle();
    if (participantReadError) return { error: `Không thể chuẩn bị xóa participant: ${participantReadError.message}` };
    const { data: roles, error: rolesReadError } = await olympia
      .from("user_roles")
      .select("user_id, role, granted_by")
      .eq("user_id", userId);
    if (rolesReadError) return { error: `Không thể chuẩn bị xóa quyền: ${rolesReadError.message}` };

    const { error: participantDeleteError } = await olympia.from("participants").delete().eq("user_id", userId);
    if (participantDeleteError) return { error: `Không thể xóa participant: ${participantDeleteError.message}` };
    const { error: roleDeleteError } = await olympia.from("user_roles").delete().eq("user_id", userId);
    if (roleDeleteError) {
      const { error: restoreError } = participant
        ? await olympia.from("participants").upsert(participant)
        : { error: null };
      const restoreMessage = restoreError ? ` Khôi phục participant thất bại: ${restoreError.message}` : " Participant đã được khôi phục.";
      return { error: `Không thể xóa quyền tài khoản: ${roleDeleteError.message}.${restoreMessage}` };
    }
    const { error: profileDeleteError } = await olympia.from("profiles").delete().eq("id", userId);
    if (profileDeleteError) {
      const [participantRestore, rolesRestore] = await Promise.all([
        participant ? olympia.from("participants").upsert(participant) : Promise.resolve({ error: null }),
        roles.length > 0 ? olympia.from("user_roles").upsert(roles) : Promise.resolve({ error: null }),
      ]);
      const restoreErrors: string[] = [];
      if (participantRestore.error) restoreErrors.push(`participant: ${participantRestore.error.message}`);
      if (rolesRestore.error) restoreErrors.push(`quyền: ${rolesRestore.error.message}`);
      const restoreMessage = restoreErrors.length > 0
        ? ` Khôi phục thất bại: ${restoreErrors.join("; ")}`
        : " Dữ liệu liên quan đã được khôi phục.";
      return { error: `Không thể xóa profile; Auth user chưa bị xóa: ${profileDeleteError.message}.${restoreMessage}` };
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(userId);
    if (authDeleteError) {
      const restoreErrors: string[] = [];
      if (profile) {
        const { error } = await olympia.from("profiles").upsert(profile);
        if (error) restoreErrors.push(`profile: ${error.message}`);
      }
      if (participant) {
        const { error } = await olympia.from("participants").upsert(participant);
        if (error) restoreErrors.push(`participant: ${error.message}`);
      }
      if (roles.length > 0) {
        const { error } = await olympia.from("user_roles").upsert(roles);
        if (error) restoreErrors.push(`quyền: ${error.message}`);
      }
      const restoreMessage = restoreErrors.length > 0
        ? ` Khôi phục dữ liệu thất bại: ${restoreErrors.join("; ")}`
        : " Dữ liệu Olympia đã được khôi phục.";
      return { error: `Không thể xóa Auth user: ${authDeleteError.message}.${restoreMessage}` };
    }
  } catch (error) {
    return { error: errorMessage(error, "Không thể kiểm tra hoặc xóa tài khoản.") };
  }

  revalidatePath("/olympia/admin/accounts");
  return { success: "Đã xóa vĩnh viễn tài khoản." };
}

export async function createOlympiaAccountAction(
  _: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const { appUserId } = await requireOlympiaAdminContext();
  const admin = getOlympiaAdminClient();
  const parsed = createAccountSchema.safeParse({
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    isParticipant: formBoolean(formData.get("isParticipant")),
    contestantCode: formData.get("contestantCode") ?? undefined,
    isAdmin: formBoolean(formData.get("isAdmin")),
    password: formData.get("password") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };

  const payload = parsed.data;
  let contestantCode: string | null = null;
  if (payload.isParticipant) {
    const code = contestantCodeSchema.safeParse(payload.contestantCode);
    if (!code.success) return { error: code.error.issues[0]?.message ?? "Mã thí sinh không hợp lệ." };
    contestantCode = code.data;
  }

  const directCreate = payload.isParticipant && isOlympiaInternalEmail(payload.email);
  let authResult: { data: { user: User | null }; error: unknown };
  if (directCreate) {
    const password = payload.password;
    if (!password || password.length < 8) {
      return { error: "Mật khẩu thí sinh phải có ít nhất 8 ký tự." };
    }
    authResult = await admin.auth.admin.createUser({
      email: payload.email,
      password,
      email_confirm: true,
      user_metadata: { display_name: payload.displayName },
    });
  } else {
    authResult = await admin.auth.admin.inviteUserByEmail(
      payload.email,
      { data: { display_name: payload.displayName } }
    );
  }
  if (authResult.error || !authResult.data.user) {
    return {
      error: isDuplicateError(authResult.error)
        ? "Email đã tồn tại."
        : errorMessage(
            authResult.error,
            directCreate ? "Không thể tạo tài khoản trực tiếp." : "Không thể gửi lời mời tài khoản."
          ),
    };
  }

  const userId = authResult.data.user.id;
  const olympia = admin.schema("olympia");
  let profileCreated = false;
  let participantCreated = false;
  let adminRoleCreated = false;
  try {
    const { error: profileError } = await olympia
      .from("profiles")
      .upsert({ id: userId, email: payload.email, display_name: payload.displayName });
    if (profileError) throw profileError;
    profileCreated = true;

    if (payload.isParticipant) {
      const { error } = await olympia.from("participants").insert({
        user_id: userId,
        contestant_code: contestantCode,
        is_active: true,
      });
      if (error) throw error;
      participantCreated = true;
    }

    if (payload.isAdmin) {
      const { error } = await olympia.from("user_roles").insert({
        user_id: userId,
        role: "admin",
        granted_by: appUserId,
      });
      if (error) throw error;
      adminRoleCreated = true;
    }
  } catch (error) {
    const originalError = isDuplicateError(error)
      ? "Contestant code hoặc quyền tài khoản đã tồn tại."
      : errorMessage(error, "Không thể hoàn tất dữ liệu tài khoản.");
    const cleanupErrors: string[] = [];

    if (adminRoleCreated) {
      const { error: roleCleanupError } = await olympia
        .from("user_roles")
        .delete()
        .eq("user_id", userId)
        .eq("role", "admin");
      if (roleCleanupError) {
        cleanupErrors.push(`Không thể cleanup quyền Admin: ${roleCleanupError.message}`);
      }
    }

    if (participantCreated) {
      const { error: participantCleanupError } = await olympia
        .from("participants")
        .delete()
        .eq("user_id", userId);
      if (participantCleanupError) {
        cleanupErrors.push(
          `Không thể cleanup participant: ${participantCleanupError.message}`
        );
      }
    }

    if (profileCreated) {
      const { error: profileCleanupError } = await olympia
        .from("profiles")
        .delete()
        .eq("id", userId);
      if (profileCleanupError) {
        cleanupErrors.push(`Không thể cleanup profile: ${profileCleanupError.message}`);
      }
    }

    const { error: authCleanupError } = await admin.auth.admin.deleteUser(userId);
    if (authCleanupError) {
      cleanupErrors.push(`Không thể cleanup Auth user: ${authCleanupError.message}`);
    }

    const cleanupMessage =
      cleanupErrors.length > 0 ? ` Cleanup thất bại: ${cleanupErrors.join(" ")}` : "";
    return {
      error: `${originalError}${cleanupMessage}`,
    };
  }

  revalidatePath("/olympia/admin/accounts");
  return directCreate
    ? {
        success: "Đã tạo trực tiếp tài khoản thí sinh. Email đã được xác nhận.",
        credentials: { email: payload.email, password: payload.password ?? "" },
      }
    : { success: "Đã gửi lời mời tài khoản Olympia." };
}

export async function updateOlympiaAccountAction(
  _: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const { appUserId } = await requireOlympiaAdminContext();
  const admin = getOlympiaAdminClient();
  const parsed = updateAccountSchema.safeParse({
    userId: formData.get("userId"),
    displayName: formData.get("displayName"),
    isAdmin: formBoolean(formData.get("isAdmin")),
    isParticipant: formBoolean(formData.get("isParticipant")),
    isParticipantActive: formBoolean(formData.get("isParticipantActive")),
    contestantCode: formData.get("contestantCode") ?? undefined,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };

  const payload = parsed.data;
  const { data: authUser, error: authError } = await admin.auth.admin.getUserById(payload.userId);
  if (authError || !authUser.user) return { error: "Tài khoản Auth không tồn tại." };
  if (payload.userId === appUserId && !payload.isAdmin) {
    return { error: "Không thể tự thu hồi quyền Admin của chính mình." };
  }

  let contestantCode: string | null = null;
  if (payload.isParticipant) {
    const code = contestantCodeSchema.safeParse(payload.contestantCode);
    if (!code.success) return { error: code.error.issues[0]?.message ?? "Mã thí sinh không hợp lệ." };
    contestantCode = code.data;
  }

  const olympia = admin.schema("olympia");
  const { data: currentAdminRole, error: currentRoleError } = await olympia
    .from("user_roles")
    .select("user_id")
    .eq("user_id", payload.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (currentRoleError) return { error: currentRoleError.message };

  if (currentAdminRole && !payload.isAdmin) {
    const { count, error } = await olympia
      .from("user_roles")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) return { error: error.message };
    if ((count ?? 0) <= 1) return { error: "Không thể thu hồi Admin cuối cùng." };
  }

  const { error: profileError } = await olympia
    .from("profiles")
    .upsert({ id: payload.userId, display_name: payload.displayName });
  if (profileError) return { error: profileError.message };

  if (payload.isParticipant) {
    const { error } = await olympia.from("participants").upsert({
      user_id: payload.userId,
      contestant_code: contestantCode,
      is_active: payload.isParticipantActive,
    });
    if (error) return { error: isDuplicateError(error) ? "Contestant code đã tồn tại." : error.message };
  } else {
    const { error } = await olympia
      .from("participants")
      .update({ is_active: false })
      .eq("user_id", payload.userId);
    if (error) return { error: error.message };
  }

  if (payload.isAdmin) {
    const { error } = await olympia.from("user_roles").upsert(
      { user_id: payload.userId, role: "admin", granted_by: appUserId },
      { onConflict: "user_id,role" }
    );
    if (error) return { error: error.message };
  } else {
    const { error } = await olympia
      .from("user_roles")
      .delete()
      .eq("user_id", payload.userId)
      .eq("role", "admin");
    if (error) return { error: error.message };
  }

  revalidatePath("/olympia/admin/accounts");
  return { success: "Đã cập nhật tài khoản Olympia." };
}
