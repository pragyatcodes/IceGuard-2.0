/**
 * JWT session handling. Analysis §6.2: "FastAPI, JWT login" — the same
 * mechanism, issued here by the Next API layer.
 *
 * Roles (§5.4):
 *   VIEWER   — maps, replay, public layers
 *   OPERATOR — + GO/SLOW/NO-GO, overrides, voyage upload
 *   ADMIN    — + accounts, thresholds, model freeze
 */
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET ?? "iceguard-dev-secret-change-me",
);
const COOKIE = "iceguard_session";
const ALG = "HS256";

export type Role = "VIEWER" | "OPERATOR" | "ADMIN";

export interface Session {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

export async function issueToken(s: Omit<Session, "sub"> & { sub: string }) {
  return new SignJWT({ email: s.email, name: s.name, role: s.role })
    .setProtectedHeader({ alg: ALG })
    .setSubject(s.sub)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(SECRET);
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET, { algorithms: [ALG] });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      role: (payload.role as Role) ?? "VIEWER",
    };
  } catch {
    return null;
  }
}

export async function setSessionCookie(token: string) {
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

/** Gate an action behind a minimum role. Order is hierarchical. */
const RANK: Record<Role, number> = { VIEWER: 0, OPERATOR: 1, ADMIN: 2 };

export function hasRole(session: Session | null, min: Role): boolean {
  if (!session) return false;
  return RANK[session.role] >= RANK[min];
}

/** Demo accounts, so the console is usable without a signup flow. */
export const DEMO_ACCOUNTS = [
  { email: "viewer@iceguard.in", password: "viewer123", role: "VIEWER" as Role },
  { email: "operator@ncpor.in", password: "operator123", role: "OPERATOR" as Role },
  { email: "admin@moes.gov.in", password: "admin123", role: "ADMIN" as Role },
];

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const [salt, hash] = user.passwordHash.split(":");
  if (!salt || !hash) return null;
  const { scryptSync, timingSafeEqual } = await import("node:crypto");
  const actual = scryptSync(password, salt, 64).toString("hex");
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return user;
}
