import { auth } from "@/lib/auth";
import { prisma } from "@rockbed/db";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "admin") return null;
  return session;
}

// GET - fetch admin settings + users
export async function GET() {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [users, allowedDomains] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.setting.findUnique({ where: { key: "allowed_domains" } }),
  ]);

  return NextResponse.json({
    users,
    allowedDomains: allowedDomains?.value ?? "",
  });
}

// POST - update settings or user roles
export async function POST(req: NextRequest) {
  const session = await getAdminSession();
  if (!session) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();

  if (body.action === "set_domains") {
    await prisma.setting.upsert({
      where: { key: "allowed_domains" },
      update: { value: body.domains },
      create: { key: "allowed_domains", value: body.domains },
    });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "set_role") {
    await prisma.user.update({
      where: { id: body.userId },
      data: { role: body.role },
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
