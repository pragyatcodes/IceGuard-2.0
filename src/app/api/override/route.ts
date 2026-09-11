import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSession, hasRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Officer override (§5.4, §10, L10).
 *
 * A duty officer may overrule GO/NO-GO — local visual ice can contradict the
 * model — but the override is logged with a mandatory reason, and the system
 * never issues helm commands. "We never silently steer the ship."
 */
const Body = z.object({
  voyageId: z.string().min(1),
  light: z.enum(["GO", "SLOW", "NO_GO"]),
  reason: z
    .string()
    .min(12, "Give a one-line reason — the audit log is the point of this.")
    .max(400),
  icebergId: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || !hasRole(session, "OPERATOR")) {
    return NextResponse.json(
      { error: "Operator or admin role required to override a verdict." },
      { status: 403 },
    );
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { voyageId, light, reason, icebergId } = parsed.data;

  const voyage = await prisma.voyage.findFirst({
    where: { OR: [{ id: voyageId }, { code: voyageId }] },
  });
  if (!voyage) return NextResponse.json({ error: "voyage not found" }, { status: 404 });

  const berg = icebergId
    ? await prisma.iceberg.findFirst({
        where: { OR: [{ id: icebergId }, { bergId: icebergId }] },
      })
    : null;

  const [advice] = await Promise.all([
    prisma.advice.create({
      data: {
        voyageId: voyage.id,
        icebergId: berg?.id ?? null,
        light,
        reason: `OVERRIDE by ${session.name}: ${reason}`,
        acknowledged: true,
        acknowledgedBy: session.sub,
        minClearanceKm: 0,
        maxIceOnRoute: 0,
        coneWidthKm: 0,
      },
    }),
    prisma.auditLog.create({
      data: {
        userId: session.sub,
        action: "OVERRIDE",
        entity: "Voyage",
        entityId: voyage.id,
        reason,
        payload: JSON.stringify({ light, voyageCode: voyage.code, icebergId: berg?.bergId ?? null }),
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    adviceId: advice.id,
    light,
    reason,
    loggedBy: session.name,
    at: advice.createdAt.toISOString(),
    notice:
      "Override recorded. ICEGUARD is decision support only — it does not replace the master's or pilot's judgement, and it issues no helm commands.",
  });
}

export async function GET() {
  const [log, advices] = await Promise.all([
    prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true, role: true } } },
    }),
    prisma.advice.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        voyage: { select: { code: true, name: true } },
        iceberg: { select: { bergId: true } },
      },
    }),
  ]);

  return NextResponse.json({
    audit: log.map((l) => ({
      id: l.id,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      reason: l.reason,
      user: l.user?.name ?? "system",
      role: l.user?.role ?? null,
      at: l.createdAt.toISOString(),
    })),
    advices: advices.map((a) => ({
      id: a.id,
      light: a.light,
      reason: a.reason,
      voyage: a.voyage.code,
      voyageName: a.voyage.name,
      berg: a.iceberg?.bergId ?? null,
      at: a.createdAt.toISOString(),
    })),
  });
}
