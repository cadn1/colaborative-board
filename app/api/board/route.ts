import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import Board from "@/models/Board";
import { checkRoomAccess, leerClave } from "@/lib/roomAccess";

export async function GET(request: Request) {
  const roomId = new URL(request.url).searchParams.get("roomId");
  if (!roomId) return NextResponse.json({ error: "roomId requerido" }, { status: 400 });

  const acceso = await checkRoomAccess(roomId, leerClave(request));
  if (acceso !== "ok") return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const board = await Board.findOne({ roomId });
  return NextResponse.json({ document: board?.document || null });
}

export async function POST(request: Request) {
  const { roomId, document } = await request.json();
  if (typeof roomId !== "string" || !document) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }

  const acceso = await checkRoomAccess(roomId, leerClave(request));
  if (acceso !== "ok") return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  await Board.findOneAndUpdate({ roomId }, { $set: { document } }, { upsert: true });
  return NextResponse.json({ success: true });
}