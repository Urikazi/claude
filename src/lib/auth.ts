import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Single-owner authentication. The dashboard holds live Shopify, Meta, Stripe and
 * PayPal credentials, so every route behind /dashboard requires a session.
 *
 * The password is never stored, only a scrypt hash in DASHBOARD_PASSWORD_HASH.
 * Sessions are a signed value in an HttpOnly cookie: no server-side session store,
 * which keeps this working on serverless hosts where instances come and go.
 */

export const SESSION_COOKIE = "pnl_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** `scrypt$<salt-hex>$<hash-hex>`, as produced by `npm run auth:hash`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  // Constant-time: a length mismatch alone must not short-circuit the comparison.
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createSessionToken(secret: string): string {
  const expiresAt = String(Date.now() + SESSION_TTL_MS);
  return `${expiresAt}.${sign(expiresAt, secret)}`;
}

/**
 * Rejects anything not signed by this deployment's secret, and anything expired.
 * Rotating SESSION_SECRET therefore logs everyone out, which is the intended way
 * to revoke access.
 */
export function verifySessionToken(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [expiresAt, signature] = token.split(".");
  if (!expiresAt || !signature) return false;

  const expected = Buffer.from(sign(expiresAt, secret), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length) return false;
  if (!timingSafeEqual(expected, actual)) return false;

  return Number(expiresAt) > Date.now();
}

/**
 * Missing configuration must fail closed. Returning "no password set = open access"
 * would silently expose a deployment whose env vars did not get set.
 */
export function authConfig(): { hash: string; secret: string } | null {
  const hash = process.env.DASHBOARD_PASSWORD_HASH;
  const secret = process.env.SESSION_SECRET;
  if (!hash || !secret) return null;
  return { hash, secret };
}
