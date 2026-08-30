import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, authConfig, verifySessionToken } from "@/lib/auth";

export async function hasValidSession(): Promise<boolean> {
  const config = authConfig();
  if (!config) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, config.secret);
}

/**
 * Guards pages. Server actions are separately reachable POST endpoints, so they
 * call `requireSession` themselves rather than relying on the page that renders
 * their form having run this.
 */
export async function requireSession(): Promise<void> {
  if (!(await hasValidSession())) redirect("/login");
}

/** Server actions return errors rather than redirecting mid-submit. */
export async function assertSession(): Promise<void> {
  if (!(await hasValidSession())) {
    throw new Error("Your session expired. Reload the page and sign in again.");
  }
}
