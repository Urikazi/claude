import { hasValidSession } from "@/lib/session";
import { getActiveStore } from "@/lib/store";
import { resolveRange } from "@/lib/format";
import { buildPnlReport } from "@/lib/pnl";
import { dailyPnlCsv } from "@/components/daily-pnl-table";

export const dynamic = "force-dynamic";

/** The daily profit sheet for the active store, as a CSV download. */
export async function GET(request: Request) {
  if (!(await hasValidSession())) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const store = await getActiveStore();
  const range = resolveRange(
    params.get("range") ?? undefined,
    params.get("from") ?? undefined,
    params.get("to") ?? undefined,
    store.timezone,
  );
  const report = await buildPnlReport(store.id, range);
  const slug = store.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const days = report.daily.map((row) => row.date);
  const filename = `${slug}-daily-pnl-${days[0]}-to-${days.at(-1)}.csv`;

  return new Response(dailyPnlCsv(report.daily, report.totals), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
