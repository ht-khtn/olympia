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
