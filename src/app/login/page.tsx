import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/session";
import { authConfig } from "@/lib/auth";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasValidSession()) redirect("/dashboard");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-lg font-semibold">PNL Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Sign in to continue.</p>
      {authConfig() ? (
        <LoginForm />
      ) : (
        <p className="mt-6 rounded border border-neg/40 bg-neg/10 p-3 text-xs text-neg">
          Authentication is not configured. Set <code>DASHBOARD_PASSWORD_HASH</code> and{" "}
          <code>SESSION_SECRET</code> in the environment, then restart. Until then the
          dashboard stays locked.
        </p>
      )}
    </main>
  );
}
