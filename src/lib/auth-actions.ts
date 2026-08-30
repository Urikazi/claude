"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, createSessionToken, verifyPassword } from "@/lib/auth";
import { completeSetup, getAuthConfig } from "@/lib/auth-config";
import type { ActionState } from "@/lib/actions";

async function startSession(secret: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, createSessionToken(secret), {
    httpOnly: true,
    sameSite: "lax",
    // Hosts terminate TLS in production; requiring it locally would break sign-in
    // over plain http://localhost.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const config = await getAuthConfig();
  if (!config) redirect("/setup");

  const password = formData.get("password")?.toString() ?? "";
  if (!verifyPassword(password, config.hash)) {
    return { ok: false, message: "Incorrect password." };
  }

  await startSession(config.secret);
  redirect("/dashboard");
}

export async function createFirstPassword(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const password = formData.get("password")?.toString() ?? "";
  if (password !== (formData.get("confirm")?.toString() ?? "")) {
    return { ok: false, message: "The two passwords do not match." };
  }

  const result = await completeSetup(password);
  if (!result.ok) return result;

  // Sign the new owner in rather than bouncing them to a login form.
  const config = await getAuthConfig();
  if (config) await startSession(config.secret);
  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
