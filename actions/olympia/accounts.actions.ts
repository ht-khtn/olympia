"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOlympiaAdminContext } from "@/lib/olympia/olympia-auth";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

export type AccountActionState = {
  error?: string | null;
  success?: string | null;
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

export async function createOlympiaAccountAction(
  _: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const { authUid } = await requireOlympiaAdminContext();
  const admin = getOlympiaAdminClient();
  const parsed = createAccountSchema.safeParse({
    email: formData.get("email"),
    displayName: formData.get("displayName"),
    isParticipant: formBoolean(formData.get("isParticipant")),
    contestantCode: formData.get("contestantCode") ?? undefined,
    isAdmin: formBoolean(formData.get("isAdmin")),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dữ liệu không hợp lệ." };

  const payload = parsed.data;
  let contestantCode: string | null = null;
  if (payload.isParticipant) {
    const code = contestantCodeSchema.safeParse(payload.contestantCode);
    if (!code.success) return { error: code.error.issues[0]?.message ?? "Mã thí sinh không hợp lệ." };
    contestantCode = code.data;
  }

  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(
    payload.email,
    { data: { display_name: payload.displayName } }
  );
  if (inviteError || !invited.user) {
    return {
      error: isDuplicateError(inviteError)
        ? "Email đã tồn tại."
        : errorMessage(inviteError, "Không thể gửi lời mời tài khoản."),
    };
  }

  const userId = invited.user.id;
  const olympia = admin.schema("olympia");
  let participantCreated = false;
  try {
    const { error: profileError } = await olympia
      .from("profiles")
      .upsert({ user_id: userId, display_name: payload.displayName });
    if (profileError) throw profileError;

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
        granted_by: authUid,
      });
      if (error) throw error;
    }
  } catch (error) {
    const originalError = isDuplicateError(error)
      ? "Contestant code hoặc quyền tài khoản đã tồn tại."
      : errorMessage(error, "Không thể hoàn tất dữ liệu tài khoản.");
    const cleanupErrors: string[] = [];

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
  return { success: "Đã gửi lời mời tài khoản Olympia." };
}

export async function updateOlympiaAccountAction(
  _: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  const { authUid } = await requireOlympiaAdminContext();
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
  if (payload.userId === authUid && !payload.isAdmin) {
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
    .upsert({ user_id: payload.userId, display_name: payload.displayName });
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
      { user_id: payload.userId, role: "admin", granted_by: authUid },
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
