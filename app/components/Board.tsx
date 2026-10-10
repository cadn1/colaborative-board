"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Excalidraw,
  CaptureUpdateAction,
  reconcileElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import {
  LiveblocksProvider,
  RoomProvider,
  useBroadcastEvent,
  useEventListener,
} from "@liveblocks/react";
import type { JsonObject } from "@liveblocks/client";

type LocalEls = Parameters<typeof reconcileElements>[0];
type RemoteEls = Parameters<typeof reconcileElements>[1];

function Pizarra({ roomId }: { roomId: string }) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [estado, setEstado] = useState("");
  const known = useRef(new Map<string, number>()); // id -> última versión enviada/recibida
  const loaded = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const eventosForzados = useRef(new WeakSet<Event>());
  const broadcast = useBroadcastEvent();

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, document: { elements } }),
      });
      setEstado(res.ok ? "Guardado ✔" : "Error al guardar");
    } catch {
      setEstado("Error al guardar");
    }
  }, [api, roomId]);

  // --- CARGAR desde MongoDB ---
  useEffect(() => {
    if (!api) return;
    let cancelled = false;

    fetch(`/api/board?roomId=${encodeURIComponent(roomId)}`)
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
        }
      })
      .catch((err) => console.error("Error al cargar de MongoDB:", err))
      .finally(() => {
        if (!cancelled) loaded.current = true;
      });

    return () => {
      cancelled = true;
    };
  }, [api, roomId]);

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
  });

  // --- ENVIAR mis cambios + autoguardado ---
  const onChange = (elements: readonly ExcalidrawElement[]) => {
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

  // --- RUEDA DEL MOUSE = ZOOM (en vez de scroll) ---
  useEffect(() => {
    const el = contenedor.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // ya convertido por nosotros, o ya es Ctrl/Cmd + rueda (pinch): no tocar
      if (eventosForzados.current.has(e) || e.ctrlKey || e.metaKey) return;
      // solo sobre el lienzo, no sobre menús o paneles con scroll
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

      // evita que Excalidraw procese este clic
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

    // sin menú contextual sobre el lienzo
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
    <div ref={contenedor} style={{ width: "100vw", height: "100vh" }}>
      <Excalidraw
        excalidrawAPI={setApi}
        onChange={onChange}
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

export default function Board() {
  const searchParams = useSearchParams();
  const nombreSala = searchParams.get("sala") || "mi-pizarra-1";

  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider id={nombreSala} initialPresence={{}}>
        <Pizarra roomId={nombreSala} />
      </RoomProvider>
    </LiveblocksProvider>
  );
}