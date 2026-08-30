import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { getAuthConfig } from "@/lib/auth-config";

export async function hasValidSession(): Promise<boolean> {
  const config = await getAuthConfig();
  if (!config) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, config.secret);
}

/**
 * Guards pages. Server actions are separately reachable POST endpoints, so they
 * call `assertSession` themselves rather than relying on the page that renders
 * their form having run this.
 */
export async function requireSession(): Promise<void> {
  if (await hasValidSession()) return;
  // Send a brand-new deployment to setup rather than to a password prompt that
  // nobody can satisfy yet.
  redirect((await getAuthConfig()) ? "/login" : "/setup");
}

/** Server actions surface an error instead of redirecting mid-submit. */
export async function assertSession(): Promise<void> {
  if (!(await hasValidSession())) {
    throw new Error("Your session expired. Reload the page and sign in again.");
  }
}
