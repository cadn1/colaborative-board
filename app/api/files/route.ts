import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/mongodb";
import BoardFile from "@/models/BoardFile";
import { puedeEscribir, puedeLeer } from "@/lib/roomAccess";

const ID_VALIDO = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_CHARS = 4_200_000; // Vercel limita el cuerpo a ~4.5 MB
const MAX_ARCHIVOS = 60;     // imágenes por sala (ajústalo)

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const roomId = sp.get("roomId");
  const fileId = sp.get("fileId");

  if (!roomId || !ID_VALIDO.test(roomId) || !fileId) {
    return NextResponse.json({ error: "Faltan datos" }, { status: 400 });
  }
  if (!(await puedeLeer(roomId, request))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  await connectToDatabase();
  const doc = await BoardFile.findOne({ roomId, fileId }).lean();
  if (!doc) return NextResponse.json({ error: "No existe" }, { status: 404 });

  return NextResponse.json({
    file: { id: doc.fileId, mimeType: doc.mimeType, dataURL: doc.dataURL, created: doc.created },
  });
}

export async function POST(request: Request) {
  const { roomId, file } = await request.json();

  if (
    typeof roomId !== "string" ||
    !ID_VALIDO.test(roomId) ||
    !file ||
    typeof file.id !== "string" ||
    file.id.length > 128 ||
    typeof file.mimeType !== "string" ||
    !file.mimeType.startsWith("image/") ||
    typeof file.dataURL !== "string" ||
    !file.dataURL.startsWith("data:image/")
  ) {
    return NextResponse.json({ error: "Archivo inválido" }, { status: 400 });
  }
  if (file.dataURL.length > MAX_CHARS) {
    return NextResponse.json({ error: "Imagen demasiado grande" }, { status: 413 });
  }

  const permiso = await puedeEscribir(roomId, request);
  if (permiso === "unauthorized") return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (permiso === "locked") return NextResponse.json({ error: "Sala bloqueada" }, { status: 403 });

  await connectToDatabase();

  const yaExiste = await BoardFile.exists({ roomId, fileId: file.id });
  if (!yaExiste && (await BoardFile.countDocuments({ roomId })) >= MAX_ARCHIVOS) {
    return NextResponse.json({ error: "Límite de imágenes alcanzado" }, { status: 429 });
  }

  await BoardFile.updateOne(
    { roomId, fileId: file.id },
    {
      $set: {
        mimeType: file.mimeType,
        dataURL: file.dataURL,
        created: typeof file.created === "number" ? file.created : Date.now(),
      },
    },
    { upsert: true }
  );

  return NextResponse.json({ success: true });
}