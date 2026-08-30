import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/**
 * Where the password hash and session key live.
 *
 * Environment variables win when present, so an operator who prefers managing
 * secrets that way keeps doing so. Otherwise they are stored in the database and
 * created through the browser on first run — deploying then needs no shell, which
 * matters because the alternative is asking someone to run a hashing command
 * before they can open their own dashboard.
 */

const PASSWORD_KEY = "auth.password_hash";
const SECRET_KEY = "auth.session_secret";

export type AuthConfig = { hash: string; secret: string };

async function readSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getAuthConfig(): Promise<AuthConfig | null> {
  const envHash = process.env.DASHBOARD_PASSWORD_HASH;
  const envSecret = process.env.SESSION_SECRET;
  if (envHash && envSecret) return { hash: envHash, secret: envSecret };

  const [hash, secret] = await Promise.all([
    envHash ? Promise.resolve(envHash) : readSetting(PASSWORD_KEY),
    envSecret ? Promise.resolve(envSecret) : readSetting(SECRET_KEY),
  ]);
  if (!hash || !secret) return null;
  return { hash, secret };
}

export async function isSetupComplete(): Promise<boolean> {
  return (await getAuthConfig()) !== null;
}

/**
 * First-run password creation. Refuses to run a second time so the setup page
 * cannot be used to take over a dashboard that already has an owner.
 */
export async function completeSetup(password: string): Promise<{ ok: boolean; message: string }> {
  if (await isSetupComplete()) {
    return { ok: false, message: "A password is already set. Sign in instead." };
  }
  if (password.length < 12) {
    return { ok: false, message: "Use at least 12 characters." };
  }

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: PASSWORD_KEY },
      create: { key: PASSWORD_KEY, value: hashPassword(password) },
      update: { value: hashPassword(password) },
    }),
    prisma.appSetting.upsert({
      where: { key: SECRET_KEY },
      create: { key: SECRET_KEY, value: randomBytes(32).toString("hex") },
      update: {},
    }),
  ]);

  return { ok: true, message: "Password set." };
}

/** Changing the password keeps the session key, so other sessions stay valid. */
export async function changePassword(password: string): Promise<{ ok: boolean; message: string }> {
  if (password.length < 12) return { ok: false, message: "Use at least 12 characters." };
  if (process.env.DASHBOARD_PASSWORD_HASH) {
    return {
      ok: false,
      message: "The password is pinned by DASHBOARD_PASSWORD_HASH. Change it in your host's environment settings.",
    };
  }
  await prisma.appSetting.upsert({
    where: { key: PASSWORD_KEY },
    create: { key: PASSWORD_KEY, value: hashPassword(password) },
    update: { value: hashPassword(password) },
  });
  return { ok: true, message: "Password changed." };
}
