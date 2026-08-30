import { redirect } from "next/navigation";
import { hasValidSession } from "@/lib/session";
import { isSetupComplete } from "@/lib/auth-config";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasValidSession()) redirect("/dashboard");
  if (!(await isSetupComplete())) redirect("/setup");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-lg font-semibold">PNL Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Sign in to continue.</p>
      <LoginForm />
    </main>
  );
}
