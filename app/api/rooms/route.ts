import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import Board from "@/models/Board";
import { hashPassword } from "@/lib/password";
import { checkRoomAccess, leerClave } from "@/lib/roomAccess";

const ID_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/;

// ¿Puedo entrar a esta sala? -> { access: "ok" | "needs-password" | "wrong-password" }
export async function GET(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId");
  if (!roomId || !ID_VALIDO.test(roomId)) {
    return NextResponse.json({ error: "roomId inválido" }, { status: 400 });
  }
  const access = await checkRoomAccess(roomId, leerClave(request));
  return NextResponse.json({ access });
}

// Crear sala (con contraseña opcional)
export async function POST(request: Request) {
  const { roomId, password } = await request.json();

  if (typeof roomId !== "string" || !ID_VALIDO.test(roomId)) {
    return NextResponse.json({ error: "Nombre de sala inválido" }, { status: 400 });
  }
  if (password && (typeof password !== "string" || password.length < 4)) {
    return NextResponse.json({ error: "La contraseña debe tener al menos 4 caracteres" }, { status: 400 });
  }

  await connectToDatabase();
  try {
    await Board.create({ roomId, passwordHash: password ? hashPassword(password) : null });
  } catch (e) {
    if ((e as { code?: number }).code === 11000) {
      return NextResponse.json({ error: "Esa sala ya existe" }, { status: 409 });
    }
    throw e;
  }
  return NextResponse.json({ success: true });
}