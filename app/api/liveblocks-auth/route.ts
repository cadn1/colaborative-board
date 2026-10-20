import { Liveblocks } from "@liveblocks/node";
import { checkRoomAccess } from "@/lib/roomAccess";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY as string,
});

export async function POST(request: Request) {
  try {
    const { room, password } = await request.json();
    if (!room || typeof room !== "string") {
      return Response.json({ error: "forbidden", reason: "Falta la sala" }, { status: 400 });
    }

    const acceso = await checkRoomAccess(room, typeof password === "string" ? password : "");
    if (acceso !== "ok") {
      return Response.json({ error: "forbidden", reason: acceso }, { status: 403 });
    }

    const session = liveblocks.prepareSession(`anon_${crypto.randomUUID()}`);
    session.allow(room, session.FULL_ACCESS);

    const { status, body } = await session.authorize();
    return new Response(body, { status });
  } catch (error) {
    console.error("Error en Liveblocks Auth:", error);
    return Response.json({ error: "forbidden", reason: "Error de autorización" }, { status: 403 });
  }
}