import type { FeeConfig } from "@prisma/client";

export const GATEWAYS = ["STRIPE", "PAYPAL", "SHOPIFY_PAYMENTS", "OTHER"] as const;
export type Gateway = (typeof GATEWAYS)[number];

export const DEFAULT_FEE_CONFIG = {
  shopifyTransactionRate: 0.006,
  stripePercent: 0.029,
  stripeFixed: 0.3,
  paypalPercent: 0.0349,
  paypalFixed: 0.49,
  defaultPercent: 0,
  defaultFixed: 0,
};

export type FeeRates = typeof DEFAULT_FEE_CONFIG;

export function toFeeRates(config?: FeeConfig | null): FeeRates {
  if (!config) return DEFAULT_FEE_CONFIG;
  return {
    shopifyTransactionRate: config.shopifyTransactionRate,
    stripePercent: config.stripePercent,
    stripeFixed: config.stripeFixed,
    paypalPercent: config.paypalPercent,
    paypalFixed: config.paypalFixed,
    defaultPercent: config.defaultPercent,
    defaultFixed: config.defaultFixed,
  };
}

/// Maps a Shopify gateway string ("stripe", "paypal", "shopify_payments", "gateway") to our enum.
export function normalizeGateway(raw?: string | null): Gateway {
  const value = (raw ?? "").toLowerCase();
  if (value.includes("paypal")) return "PAYPAL";
  if (value.includes("stripe")) return "STRIPE";
  if (value.includes("shopify_payments") || value.includes("shopify payments")) {
    return "SHOPIFY_PAYMENTS";
  }
  return "OTHER";
}

/// The processor's cut of an order, from the configured rates.
export function estimateProcessorFee(
  gateway: string,
  amount: number,
  rates: FeeRates,
): number {
  if (amount <= 0) return 0;
  switch (gateway) {
    case "STRIPE":
      return amount * rates.stripePercent + rates.stripeFixed;
    case "PAYPAL":
      return amount * rates.paypalPercent + rates.paypalFixed;
    // Shopify Payments is itself powered by Stripe and bills at the same shape.
    case "SHOPIFY_PAYMENTS":
      return amount * rates.stripePercent + rates.stripeFixed;
    default:
      return amount * rates.defaultPercent + rates.defaultFixed;
  }
}

/// Shopify bills its transaction fee on every order not paid through Shopify Payments.
export function shopifyTransactionFee(
  gateway: string,
  amount: number,
  rates: FeeRates,
): number {
  if (amount <= 0) return 0;
  if (gateway === "SHOPIFY_PAYMENTS") return 0;
  return amount * rates.shopifyTransactionRate;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
