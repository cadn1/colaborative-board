import { Liveblocks } from "@liveblocks/node";

// Inicializamos Liveblocks con tu clave secreta de las variables de entorno
const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY as string,
});

export async function POST(request: Request) {
  try {
    // Obtenemos a qué sala intenta entrar el usuario
    const body = await request.json();
    const { room } = body;

    // Creamos un usuario anónimo con un ID aleatorio
    const session = liveblocks.prepareSession(
      `anon_${Math.floor(Math.random() * 10000)}`
    );

    // Le damos acceso total (lectura y escritura) a esa sala específica
    if (room) {
      session.allow(room, session.FULL_ACCESS);
    }

    // Autorizamos y enviamos el token al frontend
    const { status, body: authBody } = await session.authorize();
    return new Response(authBody, { status });

  } catch (error) {
    console.error("Error en Liveblocks Auth:", error);
    return new Response("Error de autorización", { status: 403 });
  }
}