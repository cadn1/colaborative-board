import Board from "./components/Board";
import { Suspense } from "react";

export default function Home() {
  return (
    <main>
      <Suspense fallback={<div>Cargando...</div>}>
        <Board />
      </Suspense>
    </main>
  );
}