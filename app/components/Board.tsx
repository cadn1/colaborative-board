"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Excalidraw,
  CaptureUpdateAction,
  reconcileElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  LiveblocksProvider,
  RoomProvider,
  useBroadcastEvent,
  useEventListener,
  useOthers,
  useUpdateMyPresence,
} from "@liveblocks/react";
import type { JsonObject } from "@liveblocks/client";

// Tipo de la presencia (lo que cada usuario comparte en vivo)
declare global {
  interface Liveblocks {
    Presence: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
      nombre: string;
      color: string;
    };
  }
}

type LocalEls = Parameters<typeof reconcileElements>[0];
type RemoteEls = Parameters<typeof reconcileElements>[1];

const COLORES = ["#e03131", "#2f9e44", "#1971c2", "#f08c00", "#9c36b5", "#0c8599"];

const estiloCentro: React.CSSProperties = {
  width: "100vw",
  height: "100vh",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  fontFamily: "sans-serif",
};
const estiloInput: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #888",
  width: 260,
  color: "#000",
  background: "#fff",
};
const estiloBoton: React.CSSProperties = {
  padding: "8px 16px",
  background: "#0070f3",
  color: "white",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: "bold",
  width: 260,
};

const headersClave = (clave: string) => ({
  "x-room-password": encodeURIComponent(clave),
});

// fileIds de las imágenes (no borradas) que aparecen en una lista de elementos
function idsDeImagenes(elements: readonly ExcalidrawElement[]): string[] {
  const ids = new Set<string>();
  for (const e of elements) {
    if (e.type === "image" && !e.isDeleted && e.fileId) ids.add(e.fileId);
  }
  return [...ids];
}

// ---------------------------------------------------------------
// PIZARRA
// ---------------------------------------------------------------
function Pizarra({ roomId, clave }: { roomId: string; clave: string }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [estado, setEstado] = useState("");
  const known = useRef(new Map<string, number>());
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const eventosForzados = useRef(new WeakSet<Event>());
  const subidos = useRef(new Set<string>()); // imágenes que ya están en el servidor
  const pidiendo = useRef(new Set<string>()); // imágenes que estoy descargando
  const broadcast = useBroadcastEvent();
  const updateMyPresence = useUpdateMyPresence();
  const others = useOthers();

  // --- GUARDAR en MongoDB ---
  const guardar = useCallback(async () => {
    if (!api || !loaded.current) return;
    const elements = api
      .getSceneElementsIncludingDeleted()
      .filter((e) => !e.isDeleted);
    setEstado("Guardando...");
    try {
      const res = await fetch("/api/board", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headersClave(clave) },
        body: JSON.stringify({ roomId, document: { elements } }),
      });
      setEstado(res.ok ? "Guardado ✔" : "Error al guardar");
    } catch {
      setEstado("Error al guardar");
    }
  }, [api, roomId, clave]);

  // --- SUBIR imágenes nuevas al servidor ---
  const subirArchivos = useCallback(
    async (elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
      for (const id of idsDeImagenes(elements)) {
        const f = files[id];
        if (!f || subidos.current.has(id)) continue;
        subidos.current.add(id); // marcar antes para no duplicar

        try {
          const res = await fetch("/api/files", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...headersClave(clave),
            },
            body: JSON.stringify({
              roomId,
              file: {
                id: f.id,
                mimeType: f.mimeType,
                dataURL: f.dataURL,
                created: f.created,
              },
            }),
          });
          if (!res.ok) {
            setEstado(
              res.status === 413
                ? "Imagen demasiado grande (máx. ~4 MB)"
                : "Error al subir la imagen"
            );
            // reintentar más tarde, salvo si es demasiado grande
            if (res.status !== 413) {
              setTimeout(() => subidos.current.delete(id), 5000);
            }
          }
        } catch {
          setEstado("Error al subir la imagen");
          setTimeout(() => subidos.current.delete(id), 5000);
        }
      }
    },
    [roomId, clave]
  );

  // --- DESCARGAR imágenes que me faltan ---
  const traerArchivos = useCallback(
    async (ids: string[], intento = 0) => {
      if (!api) return;
      const tengo = api.getFiles();
      const faltan = ids.filter(
        (id) => !tengo[id] && !pidiendo.current.has(id)
      );
      if (faltan.length === 0) return;
      faltan.forEach((id) => pidiendo.current.add(id));

      const resultados = await Promise.all(
        faltan.map(async (id) => {
          try {
            const res = await fetch(
              `/api/files?roomId=${encodeURIComponent(roomId)}&fileId=${encodeURIComponent(id)}`,
              { headers: headersClave(clave) }
            );
            if (!res.ok) return null;
            const { file } = await res.json();
            return file as BinaryFileData;
          } catch {
            return null;
          }
        })
      );

      const recibidos = resultados.filter(
        (f): f is BinaryFileData => f !== null
      );
      if (recibidos.length > 0) {
        recibidos.forEach((f) => subidos.current.add(f.id));
        api.addFiles(recibidos);
      }

      faltan.forEach((id) => pidiendo.current.delete(id));

      // Puede que el otro usuario aún esté subiendo la imagen: reintentar
      const llegaron = new Set<string>(recibidos.map((f) => f.id));
      const aunFaltan = faltan.filter((id) => !llegaron.has(id));
      if (aunFaltan.length > 0 && intento < 6) {
        setTimeout(() => traerArchivos(aunFaltan, intento + 1), 1500);
      }
    },
    [api, roomId, clave]
  );

  // --- CARGAR desde MongoDB ---
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    fetch(`/api/board?roomId=${encodeURIComponent(roomId)}`, {
      headers: headersClave(clave),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const saved = data?.document?.elements;
        if (Array.isArray(saved)) {
          saved.forEach((e: ExcalidrawElement) =>
            known.current.set(e.id, e.version)
          );
          api.updateScene({
            elements: saved,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          traerArchivos(idsDeImagenes(saved));
        }
      })
      .catch((err) => console.error("Error al cargar de MongoDB:", err))
      .finally(() => {
        if (!cancelled) loaded.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [api, roomId, clave, traerArchivos]);

  // --- RECIBIR cambios de otros usuarios (Liveblocks) ---
  useEventListener(({ event }) => {
    if (!api) return;
    const e = event as unknown as { type?: string; elements?: unknown[] };
    if (e.type !== "elements" || !Array.isArray(e.elements)) return;

    const merged = reconcileElements(
      api.getSceneElementsIncludingDeleted() as unknown as LocalEls,
      e.elements as unknown as RemoteEls,
      api.getAppState()
    );
    merged.forEach((el) => known.current.set(el.id, el.version));
    api.updateScene({
      elements: merged,
      captureUpdate: CaptureUpdateAction.NEVER,
    });

    // si llegaron imágenes nuevas, bajarlas
    traerArchivos(idsDeImagenes(e.elements as unknown as ExcalidrawElement[]));
  });

  // --- CURSORES DE LOS DEMÁS ---
  useEffect(() => {
    if (!api) return;
    const collaborators = new Map();
    others.forEach((o) => {
      collaborators.set(String(o.connectionId), {
        pointer: o.presence.pointer ?? undefined,
        username: o.presence.nombre,
        color: { background: o.presence.color, stroke: o.presence.color },
      });
    });
    api.updateScene({ collaborators });
  }, [others, api]);

  // --- ENVIAR mis cambios + subir imágenes + autoguardado ---
  const onChange = (
    elements: readonly ExcalidrawElement[],
    _appState: unknown,
    files: BinaryFiles
  ) => {
    // imágenes nuevas -> al servidor (aunque no haya otros cambios)
    subirArchivos(elements, files);

    const changed = elements.filter(
      (el) => known.current.get(el.id) !== el.version
    );
    if (changed.length === 0) return;

    changed.forEach((el) => known.current.set(el.id, el.version));
    broadcast({ type: "elements", elements: changed } as unknown as JsonObject);

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(guardar, 2000);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // --- RUEDA DEL MOUSE = ZOOM ---
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (eventosForzados.current.has(e) || e.ctrlKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== "CANVAS") return;

      e.preventDefault();
      e.stopPropagation();

      const nuevo = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: true,
      });
      eventosForzados.current.add(nuevo);
      target.dispatchEvent(nuevo);
    };

    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  // --- CLIC DERECHO + ARRASTRAR = MOVER EL LIENZO ---
  useEffect(() => {
    const el = contenedor.current;
    if (!el || !api) return;

    let paneando = false;
    let ultimoX = 0;
    let ultimoY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 2) return;
      const target = e.target as HTMLElement | null;
      if (!target || target.tagName !== "CANVAS") return;

      e.preventDefault();
      e.stopPropagation();

      paneando = true;
      ultimoX = e.clientX;
      ultimoY = e.clientY;
      el.style.cursor = "grabbing";
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp, true);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!paneando) return;
      const dx = e.clientX - ultimoX;
      const dy = e.clientY - ultimoY;
      ultimoX = e.clientX;
      ultimoY = e.clientY;

      const { scrollX, scrollY, zoom } = api.getAppState();
      api.updateScene({
        appState: {
          scrollX: scrollX + dx / zoom.value,
          scrollY: scrollY + dy / zoom.value,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      e.stopPropagation();
      paneando = false;
      el.style.cursor = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp, true);
    };

    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === "CANVAS") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    el.addEventListener("pointerdown", onPointerDown, true);
    el.addEventListener("contextmenu", onContextMenu, true);

    return () => {
      el.removeEventListener("pointerdown", onPointerDown, true);
      el.removeEventListener("contextmenu", onContextMenu, true);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp, true);
      el.style.cursor = "";
    };
  }, [api]);

  return (
    <div
      ref={contenedor}
      style={{ width: "100vw", height: "100vh" }}
      onPointerLeave={() => updateMyPresence({ pointer: null })}
    >
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        onPointerUpdate={({ pointer }) => updateMyPresence({ pointer })}
        renderTopRightUI={() => (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12 }}>{estado}</span>
            <button
              onClick={guardar}
              style={{
                padding: "6px 12px",
                background: "#0070f3",
                color: "white",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: "bold",
              }}
            >
              💾 Guardar
            </button>
          </div>
        )}
      />
    </div>
  );
}

// ---------------------------------------------------------------
// PUERTA DE ENTRADA A LA SALA (verifica contraseña si la hay)
// ---------------------------------------------------------------
function SalaGate({ sala }: { sala: string }) {
  const [fase, setFase] = useState<"cargando" | "pedir" | "ok">("cargando");
  const [clave, setClave] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  // Identidad para los cursores (se genera una vez)
  const [yo] = useState(() => ({
    pointer: null,
    nombre:
      localStorage.getItem("nombre") ||
      `Anónimo ${Math.floor(100 + Math.random() * 900)}`,
    color: COLORES[Math.floor(Math.random() * COLORES.length)],
  }));

  const verificar = useCallback(
    async (pw: string) => {
      try {
        const res = await fetch(`/api/rooms?roomId=${encodeURIComponent(sala)}`, {
          headers: headersClave(pw),
        });
        const { access } = await res.json();
        if (access === "ok") {
          sessionStorage.setItem(`pw:${sala}`, pw);
          setClave(pw);
          setError("");
          setFase("ok");
        } else {
          sessionStorage.removeItem(`pw:${sala}`);
          setError(access === "wrong-password" ? "Contraseña incorrecta" : "");
          setFase("pedir");
        }
      } catch {
        setError("No se pudo verificar la sala");
        setFase("pedir");
      }
    },
    [sala]
  );

  useEffect(() => {
    verificar(sessionStorage.getItem(`pw:${sala}`) ?? "");
  }, [sala, verificar]);

  if (fase === "cargando") {
    return <div style={estiloCentro}>Cargando pizarra colaborativa...</div>;
  }

  if (fase === "pedir") {
    return (
      <div style={estiloCentro}>
        <h2>🔒 Sala privada: {sala}</h2>
        <input
          type="password"
          placeholder="Contraseña"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && verificar(input)}
          style={estiloInput}
        />
        <button onClick={() => verificar(input)} style={estiloBoton}>
          Entrar
        </button>
        {error && <span style={{ color: "#e03131" }}>{error}</span>}
      </div>
    );
  }

  return (
    <LiveblocksProvider
      authEndpoint={async (room) => {
        const res = await fetch("/api/liveblocks-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, password: clave }),
        });
        return await res.json();
      }}
    >
      <RoomProvider id={sala} initialPresence={yo}>
        <Pizarra roomId={sala} clave={clave} />
      </RoomProvider>
    </LiveblocksProvider>
  );
}

// ---------------------------------------------------------------
// LOBBY: crear o entrar a una sala
// ---------------------------------------------------------------
function Lobby() {
  const router = useRouter();
  const [nombreSala, setNombreSala] = useState("");
  const [clave, setClave] = useState("");
  const [tuNombre, setTuNombre] = useState(
    () => localStorage.getItem("nombre") ?? ""
  );
  const [error, setError] = useState("");

  const limpiar = (s: string) =>
    s.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);

  const guardarNombre = () => localStorage.setItem("nombre", tuNombre.trim());

  const crear = async () => {
    setError("");
    guardarNombre();
    const id = limpiar(nombreSala) || crypto.randomUUID().slice(0, 8);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: id, password: clave }),
    });
    if (res.status === 409) return setError("Esa sala ya existe");
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error ?? "No se pudo crear la sala");
    }
    if (clave) sessionStorage.setItem(`pw:${id}`, clave);
    router.push(`/?sala=${id}`);
  };

  const entrar = () => {
    setError("");
    guardarNombre();
    const id = limpiar(nombreSala);
    if (!id) return setError("Escribe el nombre de la sala");
    router.push(`/?sala=${id}`);
  };

  return (
    <div style={estiloCentro}>
      <h2>Pizarra colaborativa</h2>
      <input
        placeholder="Tu nombre (opcional)"
        value={tuNombre}
        onChange={(e) => setTuNombre(e.target.value)}
        style={estiloInput}
      />
      <input
        placeholder="Nombre de la sala"
        value={nombreSala}
        onChange={(e) => setNombreSala(e.target.value)}
        style={estiloInput}
      />
      <input
        type="password"
        placeholder="Contraseña (opcional, para crear)"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        style={estiloInput}
      />
      <button onClick={crear} style={estiloBoton}>
        Crear sala
      </button>
      <button onClick={entrar} style={{ ...estiloBoton, background: "#444" }}>
        Entrar a una sala
      </button>
      {error && <span style={{ color: "#e03131" }}>{error}</span>}
    </div>
  );
}

// ---------------------------------------------------------------
// PRINCIPAL
// ---------------------------------------------------------------
export default function Board() {
  const sala = useSearchParams().get("sala");
  return sala ? <SalaGate key={sala} sala={sala} /> : <Lobby />;
}