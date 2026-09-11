import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { dataHealth, modelConfidence } from "@/lib/pipeline/forecast";
import { replaySummary } from "@/lib/pipeline/replay";

export const dynamic = "force-dynamic";

/**
 * Feed health + model state. Drives the top-bar clock and the green/amber/red
 * dots (§5.1). L8: if SAR age exceeds the threshold the badge cannot be GO,
 * so the console needs this before it will render a verdict.
 */
export async function GET() {
  const [feeds, model, thresholds] = await Promise.all([
    prisma.dataSource.findMany({ orderBy: { category: "asc" } }),
    prisma.modelVersion.findFirst({ orderBy: { createdAt: "desc" } }),
    prisma.threshold.findMany(),
  ]);

  const live = dataHealth();
  const conf = modelConfidence();
  const metrics = model ? (JSON.parse(model.metrics) as Record<string, unknown>) : {};
  const sar = live.find((f) => f.code === "SENTINEL1");

  return NextResponse.json({
    utc: new Date().toISOString(),
    feeds: live.map((f) => {
      const stored = feeds.find((s) => s.code === f.code);
      return {
        ...f,
        storedStatus: stored?.status ?? f.status,
        note: stored?.note ?? f.note,
      };
    }),
    sarAgeH: sar?.ageH ?? 0,
    model: {
      version: model?.version ?? conf.version,
      frozen: model?.frozen ?? false,
      confidence: +conf.value.toFixed(3),
      metrics,
    },
    thresholds: Object.fromEntries(thresholds.map((t) => [t.key, t.value])),
    replay: {
      maeKm: replaySummary().maeKm.model,
      physicsMaeKm: replaySummary().maeKm.physics,
      targets: replaySummary().targets,
    },
  });
}
