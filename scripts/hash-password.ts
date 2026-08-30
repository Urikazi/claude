/**
 * Prints the env vars needed to lock down a deployment:
 *
 *   npm run auth:hash -- 'your password here'
 *
 * The password itself is never stored anywhere — only the scrypt hash below.
 */
import { randomBytes } from "node:crypto";
import { hashPassword } from "../src/lib/auth";

const password = process.argv[2];

if (!password) {
  console.error("Usage: npm run auth:hash -- 'your password'");
  process.exit(1);
}
if (password.length < 12) {
  console.error(`Password is ${password.length} characters; use at least 12.`);
  process.exit(1);
}

console.log(`DASHBOARD_PASSWORD_HASH="${hashPassword(password)}"`);
console.log(`SESSION_SECRET="${randomBytes(32).toString("hex")}"`);
console.log(`SYNC_SECRET="${randomBytes(24).toString("hex")}"`);
