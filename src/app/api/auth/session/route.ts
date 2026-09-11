import { NextResponse } from "next/server";
import { getSession, DEMO_ACCOUNTS } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  return NextResponse.json({
    authenticated: !!session,
    user: session
      ? { id: session.sub, email: session.email, name: session.name, role: session.role }
      : null,
    demoAccounts: DEMO_ACCOUNTS.map((a) => ({ email: a.email, role: a.role })),
  });
}
