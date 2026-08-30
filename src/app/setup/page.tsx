import { redirect } from "next/navigation";
import { isSetupComplete } from "@/lib/auth-config";
import { SetupForm } from "@/components/setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupComplete()) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="text-lg font-semibold">Choose a password</h1>
      <p className="mt-1 text-sm text-muted">
        This dashboard will hold live Shopify, Meta, Stripe and PayPal credentials. Set a
        password now to lock it — you will need it every time you sign in.
      </p>
      <SetupForm />
      <p className="mt-4 text-xs text-muted">
        Do this straight after deploying. Until a password is set, anyone who reaches this URL
        can set it.
      </p>
    </main>
  );
}
