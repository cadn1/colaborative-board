import { Suspense } from "react";
import dynamic from "next/dynamic";

// Importación dinámica: Obligamos a que la pizarra solo se cargue en el navegador (ssr: false)
const Board = dynamic(() => import("./components/Board"), { 
  ssr: false,
  loading: () => <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Cargando pizarra colaborativa...</div>
});

export default function Home() {
  return (
    <main>
      <Suspense fallback={<div>Preparando entorno...</div>}>
        <Board />
      </Suspense>
    </main>
  );
}