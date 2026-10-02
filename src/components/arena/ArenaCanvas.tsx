// The isometric night-office arena. PixiJS is loaded only in the browser; the scene lives in
// ./office and reads everything it needs from refs, so React re-renders never touch the canvas.
import { useEffect, useRef, type MutableRefObject } from "react";
import { Maximize2 } from "lucide-react";
import type { ArenaAction } from "@/lib/arena/data";
import type { OfficeData } from "@/lib/arena/office-data";
import type { OfficeScene, SceneAgent } from "./office/scene";

export type CanvasAgent = SceneAgent;

type Props = {
  agentsRef: MutableRefObject<CanvasAgent[]>;
  agentsReadyRef: MutableRefObject<boolean>;
  queueRef: MutableRefObject<ArenaAction[]>;
  dataRef: MutableRefObject<{ data: OfficeData; version: number }>;
  selectedRef: MutableRefObject<string | null>;
  onSelect: (agentId: string) => void;
  className?: string;
};

export function ArenaCanvas({
  agentsRef,
  agentsReadyRef,
  queueRef,
  dataRef,
  selectedRef,
  onSelect,
  className,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let scene: OfficeScene | null = null;
    let cancelled = false;
    void import("./office/scene").then(({ OfficeScene }) => {
      if (cancelled) return;
      scene = new OfficeScene(host, minimapRef.current, {
        agents: agentsRef,
        agentsReady: agentsReadyRef,
        queue: queueRef,
        data: dataRef,
        selected: selectedRef,
        onSelect: (id) => selectRef.current(id),
      });
      sceneRef.current = scene;
      void scene.start();
    });
    return () => {
      cancelled = true;
      scene?.destroy();
      sceneRef.current = null;
    };
  }, [agentsRef, agentsReadyRef, queueRef, dataRef, selectedRef]);

  return (
    <div className={className}>
      <div
        ref={hostRef}
        className="absolute inset-0"
        aria-label="Live agent office: agents walk between rooms as they act"
        role="img"
      />
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
        <button
          type="button"
          onClick={() => sceneRef.current?.fitView()}
          className="flex items-center gap-1 rounded-md border border-border bg-card/90 px-2 py-1 font-display text-[10px] uppercase text-muted-foreground hover:text-foreground"
          aria-label="Show the whole office"
        >
          <Maximize2 className="size-3" /> Fit
        </button>
        <canvas
          ref={minimapRef}
          className="h-[84px] w-[124px] rounded-lg border border-border bg-[#0b1020]/90 sm:h-[118px] sm:w-[176px]"
          aria-label="Office minimap: click a room to focus it"
        />
      </div>
    </div>
  );
}
