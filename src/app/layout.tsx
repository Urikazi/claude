import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PNL Dashboard",
  description: "Track store profitability across Shopify, Meta Ads, Stripe and PayPal.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-bg text-body antialiased">{children}</body>
    </html>
  );
}
