import { Liveblocks } from "@liveblocks/node";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY as string,
});

export async function POST(request: Request) {
  // Generamos un usuario aleatorio para la prueba local
  const session = liveblocks.prepareSession(`user-${Math.floor(Math.random() * 1000)}`);
  
  // Damos acceso total a la sala "mi-pizarra-1"
  session.allow("mi-pizarra-1", session.FULL_ACCESS);
  
  const { status, body } = await session.authorize();
  return new Response(body, { status });
}