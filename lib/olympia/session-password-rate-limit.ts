import "server-only";

import { createHash } from "crypto";
import { headers } from "next/headers";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

const WINDOW_MINUTES = 15;
const MAX_FAILURES = 5;

function hashAttemptKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function getAttemptKey(): Promise<string> {
  const requestHeaders = await headers();
  const forwardedFor = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = requestHeaders.get("x-real-ip")?.trim();
  const userAgent = requestHeaders.get("user-agent")?.trim() ?? "unknown";
  return hashAttemptKey(`${forwardedFor ?? realIp ?? "unknown"}\u0000${userAgent}`);
}

export async function isOlympiaPasswordRateLimited(
  sessionId: string,
  scope: "player" | "mc"
): Promise<boolean> {
  const attemptKeyHash = await getAttemptKey();
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();
  const olympia = getOlympiaAdminClient().schema("olympia");
  const { count, error } = await olympia
    .from("session_password_attempts")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("access_type", scope)
    .eq("attempt_key_hash", attemptKeyHash)
    .eq("succeeded", false)
    .gte("created_at", since);

  if (error) throw new Error("Không thể kiểm tra giới hạn thử mật khẩu.");
  return (count ?? 0) >= MAX_FAILURES;
}

export async function recordOlympiaPasswordAttempt(input: {
  sessionId: string;
  scope: "player" | "mc";
  succeeded: boolean;
}): Promise<void> {
  const olympia = getOlympiaAdminClient().schema("olympia");
  const { error } = await olympia.from("session_password_attempts").insert({
    session_id: input.sessionId,
    access_type: input.scope,
    attempt_key_hash: await getAttemptKey(),
    succeeded: input.succeeded,
  });
  if (error) throw new Error("Không thể ghi nhận lần thử mật khẩu.");
}
