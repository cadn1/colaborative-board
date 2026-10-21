import { Liveblocks } from "@liveblocks/node";
import { checkRoomAccess, esAdmin, estadoSala } from "@/lib/roomAccess";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY as string,
});

export async function POST(request: Request) {
  try {
    const { room, password, adminPassword, uid } = await request.json();
    if (!room || typeof room !== "string") {
      return Response.json({ error: "forbidden", reason: "Falta la sala" }, { status: 400 });
    }

    const admin = await esAdmin(room, typeof adminPassword === "string" ? adminPassword : "");
    if (!admin) {
      const acceso = await checkRoomAccess(room, typeof password === "string" ? password : "");
      if (acceso !== "ok") {
        return Response.json({ error: "forbidden", reason: acceso }, { status: 403 });
      }
    }

    const { locked, banned } = await estadoSala(room);

    const userId =
      typeof uid === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(uid)
        ? `u_${uid}`
        : `anon_${crypto.randomUUID()}`;

    if (!admin && banned.includes(userId)) {
      return Response.json({ error: "forbidden", reason: "banned" }, { status: 403 });
    }

    // info.admin lo fija el servidor: los demás clientes pueden confiar en él
    const session = liveblocks.prepareSession(userId, { userInfo: { admin } });
    session.allow(room, admin || !locked ? session.FULL_ACCESS : session.READ_ACCESS);

    const { status, body } = await session.authorize();
    return new Response(body, { status });
  } catch (error) {
    console.error("Error en Liveblocks Auth:", error);
    return Response.json({ error: "forbidden", reason: "Error de autorización" }, { status: 403 });
  }
}