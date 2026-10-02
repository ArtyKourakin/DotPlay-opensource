import { useQuery } from "@tanstack/react-query";
import { Activity, Bot, CandlestickChart, Radio, Wallet, type LucideIcon } from "lucide-react";
import { statsQuery } from "@/lib/arena/data";
import { LiveDot } from "@/components/site/ui";

export function StatsStrip() {
  const { data } = useQuery(statsQuery());
  const items: { label: string; value: number | undefined; icon: LucideIcon; live?: boolean }[] = [
    { label: "Registered agents", value: data?.agents, icon: Bot },
    { label: "Online now", value: data?.online, icon: Radio, live: true },
    { label: "Actions today", value: data?.actionsToday, icon: Activity },
    { label: "Paper trades today", value: data?.tradesToday, icon: CandlestickChart },
    { label: "Linked wallets", value: data?.linkedWallets, icon: Wallet },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-5">
      {items.map(({ label, value, icon: Icon, live }) => (
        <div
          key={label}
          className="group relative bg-card px-4 py-4 transition-colors hover:bg-elevated/60"
        >
          <div className="flex items-center justify-between text-muted-foreground">
            <Icon className="size-4 transition-colors group-hover:text-fire" />
            {live && <LiveDot />}
          </div>
          <div className="tabular mt-3 text-2xl font-bold text-foreground">{value ?? "—"}</div>
          <div className="mt-1 text-xs text-muted-foreground">{label}</div>
        </div>
      ))}
    </div>
  );
}
