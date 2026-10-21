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
  useSelf,
  useUpdateMyPresence,
} from "@liveblocks/react";
import type { JsonObject } from "@liveblocks/client";

declare global {
  interface Liveblocks {
    Presence: {
      pointer: { x: number; y: number; tool: "pointer" | "laser" } | null;
      nombre: string;
      color: string;
    };
    UserMeta: {
      id: string;
      info: { admin: boolean };
    };
  }
}

type LocalEls = Parameters<typeof reconcileElements>[0];
type RemoteEls = Parameters<typeof reconcileElements>[1];
type InfoSala = { admin: boolean; locked: boolean; banned: string[] };

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
const estiloTop: React.CSSProperties = {
  padding: "6px 12px",
  color: "white",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
  fontWeight: "bold",
};
const estiloMini: React.CSSProperties = {
  padding: "4px 10px",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: "bold",
};

// Identidad estable de este navegador (la usan los baneos)
function getUid(): string {
  let v = localStorage.getItem("uid");
  if (!v) {
    v = crypto.randomUUID().replace(/-/g, "");
    localStorage.setItem("uid", v);
  }
  return v;
}

const headersAuth = (clave: string, adminKey: string) => ({
  "x-room-password": encodeURIComponent(clave),
  "x-admin-password": encodeURIComponent(adminKey),
  "x-user-id": getUid(),
});

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
function Pizarra({
  roomId,
  clave,
  adminKey,
  inicial,
}: {
  roomId: string;
  clave: string;
  adminKey: string;
  inicial: InfoSala;
}) {
  const esAdmin = inicial.admin;
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [estado, setEstado] = useState("");
  const [panel, setPanel] = useState(false);
  const [bloqueada, setBloqueada] = useState(inicial.locked);
  const [baneados, setBaneados] = useState<string[]>(inicial.banned);
  const [expulsado, setExpulsado] = useState(false);

  const bloqueadaRef = useRef(inicial.locked);
  const baneadosRef = useRef(new Set<string>(inicial.banned));
  const known = useRef(new Map<string, number>());
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const eventosForzados = useRef(new WeakSet<Event>());
  const subidos = useRef(new Set<string>());
  const pidiendo = useRef(new Set<string>());

  const broadcast = useBroadcastEvent();
  const updateMyPresence = useUpdateMyPresence();
  const others = useOthers();
  const miId = useSelf((me) => me.id);

  const aplicarLock = (v: boolean) => {
    bloqueadaRef.current = v;
    setBloqueada(v);
  };
  const aplicarBan = (id: string, v: boolean) => {
    if (v) baneadosRef.current.add(id);
    else baneadosRef.current.delete(id);
    setBaneados([...baneadosRef.current]);
  };

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
        headers: { "Content-Type": "application/json", ...headersAuth(clave, adminKey) },
        body: JSON.stringify({ roomId, document: { elements } }),
      });
      setEstado(
        res.ok ? "Guardado ✔" : res.status === 403 ? "Sala bloqueada" : "Error al guardar"
      );
    } catch {
      setEstado("Error al guardar");
    }
  }, [api, roomId, clave, adminKey]);

  // --- SUBIR imágenes nuevas ---
  const subirArchivos = useCallback(
    async (elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
      for (const id of idsDeImagenes(elements)) {
        const f = files[id];
        if (!f || subidos.current.has(id)) continue;
        subidos.current.add(id);

        try {
          const res = await fetch("/api/files", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headersAuth(clave, adminKey) },
            body: JSON.stringify({
              roomId,
              file: { id: f.id, mimeType: f.mimeType, dataURL: f.dataURL, created: f.created },
            }),
          });
          if (!res.ok) {
            if (res.status === 413) setEstado("Imagen demasiado grande (máx. ~4 MB)");
            else if (res.status === 429) setEstado("Límite de imágenes de la sala alcanzado");
            else if (res.status === 403) setEstado("Sala bloqueada");
            else {
              setEstado("Error al subir la imagen");
              setTimeout(() => subidos.current.delete(id), 5000);
            }
          }
        } catch {
          setEstado("Error al subir la imagen");
          setTimeout(() => subidos.current.delete(id), 5000);
        }
      }
    },
    [roomId, clave, adminKey]
  );

  // --- DESCARGAR imágenes que me faltan ---
  const traerArchivos = useCallback(
    async (ids: string[], intento = 0) => {
      if (!api) return;
      const tengo = api.getFiles();
      const faltan = ids.filter((id) => !tengo[id] && !pidiendo.current.has(id));
      if (faltan.length === 0) return;
      faltan.forEach((id) => pidiendo.current.add(id));

      const resultados = await Promise.all(
        faltan.map(async (id) => {
          try {
            const res = await fetch(
              `/api/files?roomId=${encodeURIComponent(roomId)}&fileId=${encodeURIComponent(id)}`,
              { headers: headersAuth(clave, adminKey) }
            );
            if (!res.ok) return null;
            const { file } = await res.json();
            return file as BinaryFileData;
          } catch {
            return null;
          }
        })
      );

      const recibidos = resultados.filter((f): f is BinaryFileData => f !== null);
      if (recibidos.length > 0) {
        recibidos.forEach((f) => subidos.current.add(f.id));
        api.addFiles(recibidos);
      }

      faltan.forEach((id) => pidiendo.current.delete(id));

      const llegaron = new Set<string>(recibidos.map((f) => f.id));
      const aunFaltan = faltan.filter((id) => !llegaron.has(id));
      if (aunFaltan.length > 0 && intento < 6) {
        setTimeout(() => traerArchivos(aunFaltan, intento + 1), 1500);
      }
    },
    [api, roomId, clave, adminKey]
  );


  // --- CARGAR desde MongoDB ---
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    fetch(`/api/board?roomId=${encodeURIComponent(roomId)}`, {
      headers: headersAuth(clave, adminKey),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const saved = data?.document?.elements;
        if (Array.isArray(saved)) {
          saved.forEach((e: ExcalidrawElement) => known.current.set(e.id, e.version));
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
  }, [api, roomId, clave, adminKey, traerArchivos]);

  // --- RECIBIR eventos de otros usuarios ---
  useEventListener(({ event, user }) => {
    if (!api) return;
    const e = event as unknown as {
      type?: string;
      elements?: unknown[];
      locked?: boolean;
      userId?: string;
    };
    const emisorAdmin = !!user?.info?.admin;
    const emisorId = user?.id;

    // Órdenes de admin: solo se aceptan si el emisor es admin (verificado por el servidor)
    if (e.type === "lock" || e.type === "ban" || e.type === "unban" || e.type === "clear") {
      if (!emisorAdmin) return;

      if (e.type === "lock") aplicarLock(!!e.locked);
      if (e.type === "ban" && typeof e.userId === "string") {
        aplicarBan(e.userId, true);
        if (e.userId === miId && !esAdmin) setExpulsado(true);
      }
      if (e.type === "unban" && typeof e.userId === "string") aplicarBan(e.userId, false);
      if (e.type === "clear") {
        known.current.clear();
        api.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
      }
      return;
    }

    if (e.type !== "elements" || !Array.isArray(e.elements)) return;
    if (!emisorId) return;
    if (baneadosRef.current.has(emisorId)) return;       // ignorar baneados
    if (bloqueadaRef.current && !emisorAdmin) return;     // sala bloqueada: solo el admin edita

    const merged = reconcileElements(
      api.getSceneElementsIncludingDeleted() as unknown as LocalEls,
      e.elements as unknown as RemoteEls,
      api.getAppState()
    );
    merged.forEach((el) => known.current.set(el.id, el.version));
    api.updateScene({ elements: merged, captureUpdate: CaptureUpdateAction.NEVER });

    traerArchivos(idsDeImagenes(e.elements as unknown as ExcalidrawElement[]));
  });

  // --- CURSORES DE LOS DEMÁS ---
  useEffect(() => {
    if (!api) return;
    const collaborators = new Map();
    others.forEach((o) => {
      if (baneados.includes(o.id)) return;
      const nombre = o.presence.nombre;
      collaborators.set(String(o.connectionId), {
        pointer: o.presence.pointer ?? undefined,
        username: o.info?.admin ? `🛡️ ${nombre}` : nombre,
        color: { background: o.presence.color, stroke: o.presence.color },
      });
    });
    api.updateScene({ collaborators });
  }, [others, api, baneados]);

  // --- ENVIAR mis cambios + imágenes + autoguardado ---
  const onChange = (
    elements: readonly ExcalidrawElement[],
    _appState: unknown,
    files: BinaryFiles
  ) => {
    subirArchivos(elements, files);

    const changed = elements.filter((el) => known.current.get(el.id) !== el.version);
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

  // --- ACCIONES DE ADMIN ---
  const accionAdmin = async (body: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headersAuth(clave, adminKey) },
        body: JSON.stringify({ roomId, ...body }),
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const alternarBloqueo = async () => {
    const nuevo = !bloqueada;
    if (!(await accionAdmin({ action: "lock", locked: nuevo }))) {
      return setEstado("No se pudo cambiar el bloqueo");
    }
    aplicarLock(nuevo);
    broadcast({ type: "lock", locked: nuevo } as unknown as JsonObject);
  };

  const expulsar = async (userId: string) => {
    if (!(await accionAdmin({ action: "ban", userId }))) {
      return setEstado("No se pudo expulsar");
    }
    aplicarBan(userId, true);
    broadcast({ type: "ban", userId } as unknown as JsonObject);
  };

  const perdonar = async (userId: string) => {
    if (!(await accionAdmin({ action: "unban", userId }))) {
      return setEstado("No se pudo desbanear");
    }
    aplicarBan(userId, false);
    broadcast({ type: "unban", userId } as unknown as JsonObject);
  };

  const limpiarPizarra = async () => {
    if (!confirm("¿Borrar TODO el contenido de la pizarra para todos?")) return;
    if (!(await accionAdmin({ action: "clear" }))) {
      return setEstado("No se pudo limpiar");
    }
    known.current.clear();
    subidos.current.clear();
    api?.updateScene({ elements: [], captureUpdate: CaptureUpdateAction.NEVER });
    broadcast({ type: "clear" } as unknown as JsonObject);
    setEstado("Pizarra limpiada ✔");
  };

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

  if (expulsado) {
    return (
      <div style={estiloCentro}>
        <h2>🚫 Fuiste expulsado de esta sala</h2>
        <button onClick={() => (window.location.href = "/")} style={estiloBoton}>
          Volver al inicio
        </button>
      </div>
    );
  }

  const soloLectura = bloqueada && !esAdmin;

  // Usuarios conectados (sin admins, sin baneados, sin duplicados)
  const conectados = new Map<string, string>();
  others.forEach((o) => {
    if (!o.info?.admin && !baneados.includes(o.id)) {
      conectados.set(o.id, o.presence.nombre);
    }
  });

  return (
    <div
      ref={contenedor}
      style={{ width: "100vw", height: "100vh", position: "relative" }}
      onPointerLeave={() => updateMyPresence({ pointer: null })}
    >
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
        onPointerUpdate={({ pointer }) => updateMyPresence({ pointer })}
        viewModeEnabled={soloLectura}
        renderTopRightUI={() => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <span style={{ fontSize: 12 }}>
      {soloLectura ? "🔒 Sala bloqueada · " : ""}
      {estado}
    </span>
    {!soloLectura && (
      <button onClick={guardar} style={{ ...estiloTop, background: "#0070f3" }}>
        💾 Guardar
      </button>
    )}
    {esAdmin && (
      <button
        onClick={() => setPanel((p) => !p)}
        style={{ ...estiloTop, background: "#c92a2a" }}
      >
        🛡️ Admin
      </button>
    )}
  </div>
)}
      />

      {esAdmin && panel && (
        <div
          style={{
            position: "absolute",
            top: 60,
            right: 12,
            zIndex: 20,
            width: 290,
            maxHeight: "70vh",
            overflowY: "auto",
            background: "#fff",
            color: "#111",
            borderRadius: 12,
            padding: 12,
            boxShadow: "0 4px 16px rgba(0,0,0,.3)",
            fontFamily: "sans-serif",
            fontSize: 14,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <strong>🛡️ Panel de admin</strong>

          <button
            onClick={alternarBloqueo}
            style={{ ...estiloMini, background: bloqueada ? "#2f9e44" : "#f08c00", padding: "8px 10px" }}
          >
            {bloqueada ? "🔓 Desbloquear sala" : "🔒 Bloquear sala (solo lectura)"}
          </button>

          <button
            onClick={limpiarPizarra}
            style={{ ...estiloMini, background: "#c92a2a", padding: "8px 10px" }}
          >
            🧹 Limpiar toda la pizarra
          </button>

          <div>
            <strong>Conectados ({conectados.size})</strong>
            {conectados.size === 0 && (
              <div style={{ color: "#777", fontSize: 12 }}>Nadie más conectado</div>
            )}
            {[...conectados].map(([id, nombre]) => (
              <div
                key={id}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 6 }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {nombre}
                </span>
                <button onClick={() => expulsar(id)} style={{ ...estiloMini, background: "#c92a2a" }}>
                  Expulsar
                </button>
              </div>
            ))}
          </div>

          {baneados.length > 0 && (
            <div>
              <strong>Expulsados ({baneados.length})</strong>
              {baneados.map((id) => (
                <div
                  key={id}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4, gap: 6 }}
                >
                  <span style={{ fontSize: 12, color: "#555" }}>…{id.slice(-6)}</span>
                  <button onClick={() => perdonar(id)} style={{ ...estiloMini, background: "#2f9e44" }}>
                    Desbanear
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// PUERTA DE ENTRADA A LA SALA
// ---------------------------------------------------------------
function SalaGate({ sala }: { sala: string }) {
  const [fase, setFase] = useState<"cargando" | "pedir" | "ok" | "baneado" | "error">("cargando");
  const [clave, setClave] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState<InfoSala>({ admin: false, locked: false, banned: [] });

  const [adminKey] = useState(() => localStorage.getItem(`admin:${sala}`) ?? "");
  const [uid] = useState(() => getUid());

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
          headers: headersAuth(pw, adminKey),
        });
        const data = await res.json();

        if (data.access === "ok") {
          sessionStorage.setItem(`pw:${sala}`, pw);
          setClave(pw);
          setInfo({
            admin: !!data.admin,
            locked: !!data.locked,
            banned: Array.isArray(data.banned) ? data.banned : [],
          });
          setError("");
          setFase("ok");
        } else if (data.access === "banned") {
          setFase("baneado");
        } else if (data.access === "needs-password" || data.access === "wrong-password") {
          sessionStorage.removeItem(`pw:${sala}`);
          setError(data.access === "wrong-password" ? "Contraseña incorrecta" : "");
          setFase("pedir");
        } else {
          setError(`Error del servidor (${res.status})`);
          setFase("error");
        }
      } catch {
        setError("No se pudo verificar la sala");
        setFase("error");
      }
    },
    [sala, adminKey]
  );

  useEffect(() => {
    verificar(sessionStorage.getItem(`pw:${sala}`) ?? "");
  }, [sala, verificar]);

  if (fase === "cargando") {
    return <div style={estiloCentro}>Cargando pizarra colaborativa...</div>;
  }

  if (fase === "baneado") {
    return (
      <div style={estiloCentro}>
        <h2>🚫 Fuiste expulsado de esta sala</h2>
        <button onClick={() => (window.location.href = "/")} style={estiloBoton}>
          Volver al inicio
        </button>
      </div>
    );
  }

  if (fase === "error") {
    return (
      <div style={estiloCentro}>
        <h2>⚠️ {error}</h2>
        <button onClick={() => verificar("")} style={estiloBoton}>
          Reintentar
        </button>
      </div>
    );
  }

  if (fase === "pedir") {
    return (
      <div style={estiloCentro}>
        <h2>🔒 Sala privada: {sala}</h2>
        <input
          type="password"
          autoComplete="new-password"
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

  const adminEfectivo = info.admin ? adminKey : "";

  return (
    <LiveblocksProvider
      authEndpoint={async (room) => {
        const res = await fetch("/api/liveblocks-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, password: clave, adminPassword: adminEfectivo, uid }),
        });
        return await res.json();
      }}
    >
      <RoomProvider id={sala} initialPresence={yo}>
        <Pizarra roomId={sala} clave={clave} adminKey={adminEfectivo} inicial={info} />
      </RoomProvider>
    </LiveblocksProvider>
  );
}

// ---------------------------------------------------------------
// LOBBY
// ---------------------------------------------------------------
function Lobby() {
  const router = useRouter();
  const [nombreSala, setNombreSala] = useState("");
  const [clave, setClave] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [tuNombre, setTuNombre] = useState(() => localStorage.getItem("nombre") ?? "");
  const [error, setError] = useState("");

  const limpiar = (s: string) => s.trim().replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 64);
  const guardarNombre = () => localStorage.setItem("nombre", tuNombre.trim());

  const crear = async () => {
    setError("");
    guardarNombre();
    const id = limpiar(nombreSala) || crypto.randomUUID().slice(0, 8);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: id, password: clave, adminPassword: adminPw }),
    });
    if (res.status === 409) return setError("Esa sala ya existe");
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(data?.error ?? "No se pudo crear la sala");
    }
    if (clave) sessionStorage.setItem(`pw:${id}`, clave);
    if (adminPw) localStorage.setItem(`admin:${id}`, adminPw);
    router.push(`/?sala=${id}`);
  };

  const entrar = () => {
    setError("");
    guardarNombre();
    const id = limpiar(nombreSala);
    if (!id) return setError("Escribe el nombre de la sala");
    if (adminPw) localStorage.setItem(`admin:${id}`, adminPw);
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
        autoComplete="new-password"
        placeholder="Contraseña de la sala (opcional)"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        style={estiloInput}
      />
      <input
        type="password"
        autoComplete="new-password"
        placeholder="Contraseña de admin (crear o entrar como admin)"
        value={adminPw}
        onChange={(e) => setAdminPw(e.target.value)}
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