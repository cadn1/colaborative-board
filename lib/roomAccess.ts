import { connectToDatabase } from "@/lib/mongodb";
import Board from "@/models/Board";
import { verifyPassword } from "@/lib/password";

export type Acceso = "ok" | "needs-password" | "wrong-password";

// La contraseña viaja en el header x-room-password (codificada para soportar tildes, ñ, etc.)
export function leerClave(request: Request): string {
  const raw = request.headers.get("x-room-password") ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export async function checkRoomAccess(roomId: string, password: string): Promise<Acceso> {
  await connectToDatabase();
  const board = await Board.findOne({ roomId }).select("passwordHash");
  if (!board?.passwordHash) return "ok"; // sala pública o inexistente
  if (!password) return "needs-password";
  return verifyPassword(password, board.passwordHash) ? "ok" : "wrong-password";
}