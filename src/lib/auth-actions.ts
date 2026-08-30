"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authConfig, createSessionToken, verifyPassword } from "@/lib/auth";
import type { ActionState } from "@/lib/actions";

export async function login(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const config = authConfig();
  if (!config) {
    return {
      ok: false,
      message:
        "Authentication is not configured. Set DASHBOARD_PASSWORD_HASH and SESSION_SECRET, then redeploy.",
    };
  }

  const password = formData.get("password")?.toString() ?? "";
  if (!verifyPassword(password, config.hash)) {
    return { ok: false, message: "Incorrect password." };
  }

  (await cookies()).set(SESSION_COOKIE, createSessionToken(config.secret), {
    httpOnly: true,
    sameSite: "lax",
    // Vercel and every other host terminate TLS, so this is safe in production and
    // would break sign-in over plain http://localhost during development.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 60 * 60,
  });

  redirect("/dashboard");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
