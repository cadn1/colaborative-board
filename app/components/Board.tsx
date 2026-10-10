"use client";

import { Tldraw, Editor, getSnapshot, loadSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'
import { RoomProvider, LiveblocksProvider } from "@liveblocks/react";
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

// --- SUBCOMPONENTE: Maneja la lógica del editor, guardado y carga ---
function PizarraConGuardado({ roomId }: { roomId: string }) {
  const [editor, setEditor] = useState<Editor | null>(null);

  // 1. CARGAR DATOS desde MongoDB
  useEffect(() => {
    if (!editor) return;

    fetch(`/api/board?roomId=${roomId}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.document) {
          loadSnapshot(editor.store, data.document);
        }
      })
      .catch((err) => console.error("Error al cargar de MongoDB:", err));
  }, [editor, roomId]);

  // 2. GUARDAR DATOS en MongoDB
  const guardarEnMongoDB = async () => {
    if (!editor) return;
    
    const snapshot = getSnapshot(editor.store);
    
    await fetch('/api/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, document: snapshot }),
    });
    
    alert('¡Pizarra guardada exitosamente en MongoDB Atlas!');
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      {/* Botón de guardado reubicado para no tapar los menús */}
      <button 
        onClick={guardarEnMongoDB}
        style={{
          position: 'absolute', 
          top: 60, 
          left: 15, 
          zIndex: 1000,
          padding: '8px 16px', 
          background: 'rgba(0, 112, 243, 0.9)', 
          color: 'white',
          border: 'none', 
          borderRadius: '8px', 
          cursor: 'pointer',
          fontWeight: 'bold', 
          boxShadow: '0 4px 6px rgba(0,0,0,0.2)',
          transition: 'background 0.2s'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = '#0070f3'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(0, 112, 243, 0.9)'}
      >
        💾 Guardar en DB
      </button>
      
      <Tldraw 
        onMount={setEditor} 
        options={{ camera: { wheelBehavior: 'zoom' } }} 
      />
    </div>
  );
}

// --- COMPONENTE PRINCIPAL: Provee la conexión multijugador ---
export default function Board() {
  const searchParams = useSearchParams();
  
  // Lee la sala de la URL (ej: /?sala=mi-proyecto), si no hay, usa "mi-pizarra-1"
  const nombreSala = searchParams.get('sala') || "mi-pizarra-1";

  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider id={nombreSala} initialPresence={{}}>
        <div style={{ width: '100vw', height: '100vh' }}>
          <PizarraConGuardado roomId={nombreSala} />
        </div>
      </RoomProvider>
    </LiveblocksProvider>
  );
}