import { timingSafeEqual } from "crypto";
import { connectToDatabase } from "@/lib/mongodb";
import Board from "@/models/Board";
import { verifyPassword } from "@/lib/password";

export type Acceso = "ok" | "needs-password" | "wrong-password";
export type Permiso = "ok" | "unauthorized" | "locked";

function decodificar(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}

export function leerClave(request: Request): string {
  return decodificar(request.headers.get("x-room-password") ?? "");
}

export function leerAdmin(request: Request): string {
  return decodificar(request.headers.get("x-admin-password") ?? "");
}

export function leerUid(request: Request): string {
  const raw = request.headers.get("x-user-id") ?? "";
  return /^[a-zA-Z0-9_-]{8,64}$/.test(raw) ? raw : "";
}

function igual(a: string, b: string): boolean {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length === B.length && timingSafeEqual(A, B);
}

export async function checkRoomAccess(roomId: string, password: string): Promise<Acceso> {
  await connectToDatabase();
  const board = await Board.findOne({ roomId }).select("passwordHash");
  if (!board?.passwordHash) return "ok"; // sala pública o inexistente
  if (!password) return "needs-password";
  return verifyPassword(password, board.passwordHash) ? "ok" : "wrong-password";
}

export async function esAdmin(roomId: string, adminPassword: string): Promise<boolean> {
  if (!adminPassword) return false;
  const master = process.env.SUPER_ADMIN_KEY;
  if (master && igual(adminPassword, master)) return true;

  await connectToDatabase();
  const board = await Board.findOne({ roomId }).select("adminHash");
  if (!board?.adminHash) return false;
  return verifyPassword(adminPassword, board.adminHash);
}

export async function estadoSala(
  roomId: string
): Promise<{ locked: boolean; banned: string[]; muted: string[] }> {
  await connectToDatabase();
  const board = await Board.findOne({ roomId }).select("locked banned muted");
  return {
    locked: !!board?.locked,
    banned: Array.isArray(board?.banned) ? (board.banned as string[]) : [],
    muted: Array.isArray(board?.muted) ? (board.muted as string[]) : [],
  };
}

// En la lista de baneados se guarda `u_<uid>` (el id que usa Liveblocks)
export async function estaBaneado(roomId: string, uid: string): Promise<boolean> {
  if (!uid) return false;
  const { banned } = await estadoSala(roomId);
  return banned.includes(`u_${uid}`);
}

export async function puedeLeer(roomId: string, request: Request): Promise<boolean> {
  if (await esAdmin(roomId, leerAdmin(request))) return true;
  if (await estaBaneado(roomId, leerUid(request))) return false;
  return (await checkRoomAccess(roomId, leerClave(request))) === "ok";
}

export async function puedeEscribir(roomId: string, request: Request): Promise<Permiso> {
  if (await esAdmin(roomId, leerAdmin(request))) return "ok";
  const uid = leerUid(request);
  if (await estaBaneado(roomId, uid)) return "unauthorized";
  if ((await checkRoomAccess(roomId, leerClave(request))) !== "ok") return "unauthorized";
  const { locked, muted } = await estadoSala(roomId);
  if (locked) return "locked";
  if (uid && muted.includes(`u_${uid}`)) return "locked"; // silenciado: también se rechaza
  return "ok";
}