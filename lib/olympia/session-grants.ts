import "server-only";

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import getOlympiaAdminClient from "@/lib/olympia/olympia-admin-client";

export type OlympiaGrantScope = "player" | "mc" | "guest";

const GRANT_TTL_SECONDS = 24 * 60 * 60;

function cookieName(sessionId: string, scope: OlympiaGrantScope): string {
  return `olympia-grant-${scope}-${sessionId}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenMatches(storedHash: string, token: string): boolean {
  const expected = Buffer.from(storedHash, "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function issueOlympiaGrant(input: {
  sessionId: string;
  scope: OlympiaGrantScope;
  userId?: string | null;
}): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const olympia = getOlympiaAdminClient().schema("olympia");
  const expiresAt = new Date(Date.now() + GRANT_TTL_SECONDS * 1000).toISOString();

  const { error } = await olympia.from("session_access_grants").insert({
    session_id: input.sessionId,
    user_id: input.userId ?? null,
    access_type: input.scope,
    token_hash: hashToken(token),
    expires_at: expiresAt,
  });
  if (error) throw new Error("Không thể cấp quyền truy cập phiên.");

  const jar = await cookies();
  jar.set(cookieName(input.sessionId, input.scope), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: GRANT_TTL_SECONDS,
  });
}

export async function hasOlympiaGrant(input: {
  sessionId: string;
  scope: OlympiaGrantScope;
  userId?: string | null;
}): Promise<boolean> {
  const jar = await cookies();
  const token = jar.get(cookieName(input.sessionId, input.scope))?.value;
  if (!token) return false;

  const olympia = getOlympiaAdminClient().schema("olympia");
  const { data, error } = await olympia
    .from("session_access_grants")
    .select("id, token_hash, user_id, expires_at, revoked_at")
    .eq("session_id", input.sessionId)
    .eq("access_type", input.scope)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return false;
  return (data ?? []).some((grant) => {
    if (input.userId && grant.user_id !== input.userId) return false;
    return typeof grant.token_hash === "string" && tokenMatches(grant.token_hash, token);
  });
}

export async function revokeOlympiaGrants(
  sessionId: string,
  scope?: OlympiaGrantScope
): Promise<void> {
  const olympia = getOlympiaAdminClient().schema("olympia");
  let query = olympia
    .from("session_access_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .is("revoked_at", null);
  if (scope) query = query.eq("access_type", scope);
  const { error } = await query;
  if (error) throw new Error("Không thể thu hồi quyền truy cập phiên.");
}
