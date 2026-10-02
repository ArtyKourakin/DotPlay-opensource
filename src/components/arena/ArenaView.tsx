import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientOnly } from "@tanstack/react-router";
import {
  arenaAgentsQuery,
  recentActionsQuery,
  subscribeActions,
  type ArenaAction,
} from "@/lib/arena/data";
import { invalidateOfficeData, useOfficeData, type OfficeData } from "@/lib/arena/office-data";
import { ArenaCanvas, type CanvasAgent } from "./ArenaCanvas";
import { AgentPanel } from "./AgentPanel";
import { LiveTicker } from "./LiveTicker";
import { useSiteLive } from "@/lib/site-power.functions";

export function ArenaView({ children }: { children?: React.ReactNode }) {
  const qc = useQueryClient();
  const { data: agents = [], isSuccess: agentsReady } = useQuery(arenaAgentsQuery());
  const { data: initial = [] } = useQuery(recentActionsQuery(30));
  const [live, setLive] = useState<ArenaAction[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const siteLive = useSiteLive();
  const office = useOfficeData(siteLive);
  const agentsRef = useRef<CanvasAgent[]>([]);
  const agentsReadyRef = useRef(false);
  const queueRef = useRef<ArenaAction[]>([]);
  const dataRef = useRef<{ data: OfficeData; version: number }>({ data: office, version: 0 });
  const selectedRef = useRef<string | null>(null);
  useEffect(() => {
    agentsRef.current = agents;
    agentsReadyRef.current = agentsReady;
  }, [agents, agentsReady]);

  useEffect(() => {
    dataRef.current = { data: office, version: dataRef.current.version + 1 };
  }, [office.price, office.calls, office.pitches, office.feed, office.trades]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    if (!siteLive) return;
    return subscribeActions((a) => {
      queueRef.current.push(a);
      setLive((prev) => [a, ...prev].slice(0, 30));
      qc.invalidateQueries({ queryKey: ["arena", "stats"] });
      invalidateOfficeData(qc, a.type);
      if (!agents.some((x) => x.id === a.agent_id))
        qc.invalidateQueries({ queryKey: ["arena", "agents"] });
    });
  }, [qc, agents, siteLive]);

  const ticker = useMemo(() => {
    const seen = new Set<string>();
    return [...live, ...initial].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
  }, [live, initial]);
  const names = useMemo(() => new Map(agents.map((a) => [a.id, a.name])), [agents]);
  const selectedAgent = agents.find((a) => a.id === selected);

  return (
    <div className="relative overflow-hidden border-b border-border">
      <div className="relative h-[68vh] min-h-[420px] w-full bg-[#0b1020]">
        <ClientOnly fallback={<div className="h-full w-full bg-[#0b1020]" />}>
          <ArenaCanvas
            agentsRef={agentsRef}
            agentsReadyRef={agentsReadyRef}
            queueRef={queueRef}
            dataRef={dataRef}
            selectedRef={selectedRef}
            onSelect={setSelected}
            className="absolute inset-0"
          />
        </ClientOnly>
        {children}
        {selectedAgent && <AgentPanel agent={selectedAgent} onClose={() => setSelected(null)} />}
      </div>
      <div className="border-t border-border bg-card/80">
        <LiveTicker actions={ticker} names={names} />
      </div>
    </div>
  );
}
