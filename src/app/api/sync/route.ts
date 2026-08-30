import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { hasValidSession } from "@/lib/session";
import { prisma } from "@/lib/db";
import {
  reconcileProcessorFees,
  syncMetaAds,
  syncShopifyOrders,
  syncShopifyProducts,
  type SyncResult,
} from "@/lib/sync";

export const dynamic = "force-dynamic";

const SOURCES = ["shopify-products", "shopify-orders", "meta", "fees"] as const;
type Source = (typeof SOURCES)[number];

/**
 * Two callers: a cron service holding SYNC_SECRET, and a signed-in browser. An
 * unset secret denies the cron path rather than opening the endpoint — this route
 * triggers live API calls and rewrites order data, so it must fail closed.
 */
async function authorize(request: NextRequest): Promise<boolean> {
  const secret = process.env.SYNC_SECRET;
  if (secret) {
    const header = request.headers.get("authorization");
    const token =
      header?.replace(/^Bearer\s+/i, "") ?? request.nextUrl.searchParams.get("token");
    if (token && timingSafeEquals(token, secret)) return true;
  }
  return hasValidSession();
}

/** Avoids leaking the secret's length or prefix through comparison timing. */
function timingSafeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function run(source: Source, storeId: string, days: number): Promise<SyncResult> {
  switch (source) {
    case "shopify-products":
      return syncShopifyProducts(storeId);
    case "shopify-orders":
      return syncShopifyOrders(storeId, days);
    case "meta":
      return syncMetaAds(storeId, days);
    case "fees":
      return reconcileProcessorFees(storeId, days);
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const days = Number.parseInt(params.get("days") ?? "60", 10) || 60;
  const requested = params.get("source");

  const storeId = params.get("storeId") ?? (await prisma.store.findFirst())?.id;
  if (!storeId) {
    return NextResponse.json({ error: "No store configured" }, { status: 404 });
  }

  const sources: Source[] =
    requested && SOURCES.includes(requested as Source)
      ? [requested as Source]
      : [...SOURCES];

  const results: SyncResult[] = [];
  const errors: { source: string; message: string }[] = [];

  for (const source of sources) {
    try {
      results.push(await run(source, storeId, days));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ source, message });
      await prisma.syncLog.create({
        data: { storeId, source, status: "error", message, endedAt: new Date() },
      });
    }
  }

  return NextResponse.json(
    { ok: errors.length === 0, results, errors },
    { status: errors.length && !results.length ? 502 : 200 },
  );
}

// Allows a scheduler that can only issue GETs (Vercel Cron, cron-job.org) to trigger a sync.
export const GET = POST;
