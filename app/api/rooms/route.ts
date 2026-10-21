import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import Board from "@/models/Board";
import { hashPassword } from "@/lib/password";
import {
  checkRoomAccess,
  esAdmin,
  estaBaneado,
  estadoSala,
  leerAdmin,
  leerClave,
  leerUid,
} from "@/lib/roomAccess";

const ID_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/;

// Estado de la sala para quien intenta entrar
export async function GET(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId");
  if (!roomId || !ID_VALIDO.test(roomId)) {
    return NextResponse.json({ error: "roomId inválido" }, { status: 400 });
  }

  const admin = await esAdmin(roomId, leerAdmin(request));

  if (!admin && (await estaBaneado(roomId, leerUid(request)))) {
    return NextResponse.json({ access: "banned", admin: false, locked: false, banned: [] });
  }

  const access = admin ? "ok" : await checkRoomAccess(roomId, leerClave(request));
  const { locked, banned } =
    access === "ok" ? await estadoSala(roomId) : { locked: false, banned: [] as string[] };

  return NextResponse.json({ access, admin, locked, banned });
}

// Crear sala (contraseña y contraseña de admin opcionales)
export async function POST(request: Request) {
  const { roomId, password, adminPassword } = await request.json();

  if (typeof roomId !== "string" || !ID_VALIDO.test(roomId)) {
    return NextResponse.json({ error: "Nombre de sala inválido" }, { status: 400 });
  }
  if (password && (typeof password !== "string" || password.length < 4)) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 4 caracteres" }, { status: 400 });
  }
  if (adminPassword && (typeof adminPassword !== "string" || adminPassword.length < 4)) {
    return NextResponse.json({ error: "La contraseña de admin debe tener al menos 4 caracteres" }, { status: 400 });
  }

  await connectToDatabase();
  try {
    await Board.create({
      roomId,
      passwordHash: password ? hashPassword(password) : null,
      adminHash: adminPassword ? hashPassword(adminPassword) : null,
    });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "Esa sala ya existe" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ success: true });
}