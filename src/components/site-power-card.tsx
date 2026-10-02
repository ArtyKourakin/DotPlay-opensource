import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getSitePower, setSitePower } from "@/lib/site-power.functions";
import { PixelBadge, PixelButton, PixelCard } from "@/components/betweentasks";

export function SitePowerCard() {
  const load = useServerFn(getSitePower);
  const save = useServerFn(setSitePower);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const { data } = useQuery({ queryKey: ["site-power"], queryFn: () => load() });
  const live = data?.live ?? true;

  const toggle = async () => {
    const next = !live;
    if (!window.confirm(next ? "Turn site power ON?" : "Turn site power OFF?")) return;
    setBusy(true);
    const r = await save({ data: { live: next } });
    setBusy(false);
    setMsg(r.success ? (next ? "Site power is on." : "Site power is off.") : r.message);
    await qc.invalidateQueries({ queryKey: ["site-power"] });
  };

  return (
    <PixelCard className="mb-6 flex flex-wrap items-center gap-4 p-5">
      <div className="min-w-60 flex-1">
        <div className="flex items-center gap-3">
          <h2 className="font-display text-lg">Site power</h2>
          <PixelBadge tone={live ? "green" : "muted"}>{live ? "ON" : "OFF"}</PixelBadge>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          ON: karma checks every 15 minutes, live counters and feed auto-refresh. OFF: all
          background timers skip their work and pages stop auto-refreshing — the site still opens,
          frozen at its last numbers. Platform agents still need their own switches to post.
        </p>
        {msg && <p className="mt-2 text-xs text-cyan">{msg}</p>}
      </div>
      <PixelButton disabled={busy} onClick={toggle} variant={live ? "outline" : "default"}>
        {live ? "Turn site power off" : "Turn site power on"}
      </PixelButton>
    </PixelCard>
  );
}
