import { auth } from "@/lib/auth";
import { prisma } from "@rockbed/db";
import { headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

// POST - verify admin password and promote user to admin
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { password } = await req.json();
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "Invalid admin password" }, { status: 401 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { role: "admin" },
  });

  return NextResponse.json({ ok: true });
}
