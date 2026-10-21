import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import Board from "@/models/Board";
import BoardFile from "@/models/BoardFile";
import { esAdmin, leerAdmin } from "@/lib/roomAccess";

const ID_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/;
const USER_ID = /^[a-zA-Z0-9_-]{1,80}$/;

export async function POST(request: Request) {
  const { roomId, action, locked, userId } = await request.json();

  if (typeof roomId !== "string" || !ID_VALIDO.test(roomId)) {
    return NextResponse.json({ error: "roomId inválido" }, { status: 400 });
  }
  if (!(await esAdmin(roomId, leerAdmin(request)))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  await connectToDatabase();

  switch (action) {
    case "lock":
      await Board.updateOne({ roomId }, { $set: { locked: !!locked } });
      break;
    case "ban":
    case "unban":
    case "mute":
    case "unmute": {
      if (typeof userId !== "string" || !USER_ID.test(userId)) {
        return NextResponse.json({ error: "userId inválido" }, { status: 400 });
      }
      const campo = action === "ban" || action === "unban" ? "banned" : "muted";
      const agregar = action === "ban" || action === "mute";
      await Board.updateOne(
        { roomId },
        agregar ? { $addToSet: { [campo]: userId } } : { $pull: { [campo]: userId } }
      );
      break;
    }
    case "clear":
      await Board.updateOne({ roomId }, { $set: { document: { elements: [] } } });
      await BoardFile.deleteMany({ roomId });
      break;
    default:
      return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}