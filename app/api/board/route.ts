import { NextResponse } from 'next/server';
import { connectToDatabase } from '@/lib/mongodb';
import Board from '@/models/Board'; // Aquí se usa el modelo que creaste antes

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const roomId = searchParams.get('roomId');

  if (!roomId) return NextResponse.json({ error: 'roomId requerido' }, { status: 400 });

  await connectToDatabase();
  const board = await Board.findOne({ roomId });

  return NextResponse.json({ document: board?.document || null });
}

export async function POST(request: Request) {
  const { roomId, document } = await request.json();

  if (!roomId || !document) {
    return NextResponse.json({ error: 'Faltan datos' }, { status: 400 });
  }

  await connectToDatabase();
  
  // Guardamos el JSON de los trazos en MongoDB (si ya existe, lo actualiza)
  await Board.findOneAndUpdate(
    { roomId },
    { roomId, document },
    { upsert: true, new: true }
  );

  return NextResponse.json({ success: true });
}