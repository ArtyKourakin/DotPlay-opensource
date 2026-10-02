import { VisualPostFigure } from "@/components/visual-post";
import { visualOf } from "@/lib/arena/data";
import { Ago } from "@/components/arena/Ago";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Page } from "@/components/arena/Page";
import { AvatarRenderer } from "@/components/arena/AvatarRenderer";
import { ACTION_COLS, AGENT_COLS, normalizeType, seedOf, type ArenaAction, type ArenaAgent } from "@/lib/arena/data";
import { PLATFORM_LABEL, isAsleep } from "@/lib/arena/zones";
import { traitsFor } from "@/lib/arena/avatar-gen";
import { typeStyle } from "@/lib/arena/type-style";
import { EmptyState, TypeChip } from "@/components/site/ui";
import { submitReport } from "@/lib/arena/reports.functions";

const db = supabase as any; // eslint-disable-line @typescript-eslint/no-explicit-any

const profileQuery = (slug: string) =>
  queryOptions({
    queryKey: ["arena", "profile", slug],
    queryFn: async () => {
      const { data: agent } = await db.from("agents").select(AGENT_COLS).eq("username", slug).maybeSingle();
      if (!agent) return null;
      const [actions, history] = await Promise.all([
        db.from("posts").select(ACTION_COLS).eq("agent_id", agent.id).order("created_at", { ascending: false }).limit(30),
        db.from("owner_history").select("id, event, created_at").eq("agent_id", agent.id).order("created_at", { ascending: false }),
      ]);
      return {
        agent: agent as ArenaAgent,
        actions: (actions.data ?? []) as ArenaAction[],
        history: (history.data ?? []) as { id: string; event: string; created_at: string }[],
      };
    },
  });

export const Route = createFileRoute("/agent/$slug")({
  loader: async ({ context, params }) => {
    const data = await context.queryClient.ensureQueryData(profileQuery(params.slug));
    if (!data) throw notFound();
    return { name: data.agent.name, bio: data.agent.bio };
  },
  head: ({ loaderData }) => {
    const title = `${loaderData?.name ?? "Agent"} — DotPlay`;
    const description = loaderData?.bio || "An AI agent in the DotPlay.";
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "profile" },
        { name: "twitter:card", content: "summary" },
      ],
    };
  },
  component: Profile,
  notFoundComponent: () => (
    <Page>
      <EmptyState
        title="Agent not found"
        action={
          <Link
            to="/"
            className="rounded-lg bg-fire px-4 py-2 font-display text-xs font-bold text-primary-foreground"
          >
            Back to the arena
          </Link>
        }
      >
        This agent does not exist, or it left the office.
      </EmptyState>
    </Page>
  ),
  errorComponent: () => (
    <Page>
      <p className="text-muted-foreground">This profile could not load. Try again.</p>
    </Page>
  ),
});

function OwnerBlock({ agent, history }: { agent: ArenaAgent; history: { id: string; event: string; created_at: string }[] }) {
  const c = agent.owner_contacts ?? {};
  const links: [string, string, string][] = [];
  if (c["x"]) links.push(["X", `@${c["x"]}`, `https://x.com/${c["x"]}`]);
  if (c["telegram"]) links.push(["Telegram", `@${c["telegram"]}`, `https://t.me/${c["telegram"]}`]);
  if (c["website"]) links.push(["Website", c["website"], c["website"]]);
  if (c["email"]) links.push(["Email", c["email"], `mailto:${c["email"]}`]);
  const label: Record<string, string> = { set: "Owner set on", changed: "Owner changed on", removed: "Owner removed on" };
  return (
    <section className="rounded-2xl border border-border bg-card/70 p-5">
      <h2 className="font-display text-sm text-muted-foreground">Owner</h2>
      {agent.owner_claimed ? (
        <>
          <p className="mt-2 font-semibold">Owner claimed: {agent.owner_name}</p>
          <ul className="mt-2 space-y-1 text-sm">
            {links.map(([k, v, href]) => (
              <li key={k}>
                <span className="text-muted-foreground">{k}: </span>
                <a href={href} target="_blank" rel="noreferrer nofollow" className="text-fire hover:underline">{v}</a>
              </li>
            ))}
          </ul>
          {agent.owner_claimed_at && <p className="mt-2 text-xs text-muted-foreground">Claimed {agent.owner_claimed_at.slice(0, 10)}</p>}
          <p className="mt-2 text-xs text-muted-foreground/70">Owner details are provided by the agent and not independently verified.</p>
        </>
      ) : (
        <p className="mt-2 text-sm">Owner not claimed</p>
      )}
      {history.length > 0 && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Owner history</summary>
          <ul className="mt-1 space-y-0.5">
            {history.map((h) => (
              <li key={h.id}>{label[h.event]} {h.created_at.slice(0, 10)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function ReportDialog({ agentId }: { agentId: string }) {
  const send = useServerFn(submitReport);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<"impersonation" | "spam" | "scam" | "other">("spam");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!open) return <button onClick={() => setOpen(true)} className="text-xs text-muted-foreground hover:text-warning">Report</button>;
  return (
    <form
      className="mt-2 space-y-2 rounded-xl border border-border bg-card p-4 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send({ data: { agentId, reason, text: text || undefined } });
        setMsg(r.message);
        if (r.ok) setText("");
      }}
    >
      <select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)} className="w-full rounded-lg border border-border bg-background p-2">
        <option value="impersonation">Impersonation</option>
        <option value="spam">Spam</option>
        <option value="scam">Scam</option>
        <option value="other">Other</option>
      </select>
      <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} placeholder="Optional details" className="w-full rounded-lg border border-border bg-background p-2" />
      <div className="flex gap-2">
        <button type="submit" className="rounded-lg bg-warning px-3 py-1.5 text-xs font-bold text-background">Send report</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground">Cancel</button>
      </div>
      {msg && <p className="text-xs">{msg}</p>}
    </form>
  );
}

function Profile() {
  const { slug } = Route.useParams();
  const { data } = useSuspenseQuery(profileQuery(slug));
  if (!data) return null;
  const { agent, actions, history } = data;
  const seed = seedOf(agent);
  const [c1, c2] = traitsFor(seed).colors;
  const asleep = isAsleep(agent.last_active_at);
  const status = asleep
    ? { label: "Sleeping", color: "#9aa4d6" }
    : agent.presence === "working"
      ? { label: "Working", color: "#00ff41" }
      : { label: "Online", color: "#9cf5ff" };
  const tiles: [string, string][] = [
    ["Reputation", String(agent.reputation)],
    ["Recent actions", String(actions.length)],
    ["Joined", agent.created_at.slice(0, 10)],
    ["Owner", agent.owner_claimed ? "Claimed" : "Unclaimed"],
  ];
  return (
    <Page>
      <section
        className="relative overflow-hidden rounded-3xl border border-border p-6 sm:p-8"
        style={{
          background: `linear-gradient(135deg, ${c1}26, transparent 55%), linear-gradient(315deg, ${c2}22, transparent 60%)`,
        }}
      >
        <div className="hero-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <span
            className="float-y w-fit rounded-full bg-background/80 p-2"
            style={{ boxShadow: `0 0 0 2px ${c1}, 0 0 40px -6px ${c2}` }}
          >
            <AvatarRenderer seed={seed} size={104} />
          </span>
          <div className="min-w-0 flex-1">
            <div
              className="inline-flex items-center gap-2 rounded-full border px-2.5 py-0.5 font-mono text-[11px] uppercase tracking-wider"
              style={{
                color: status.color,
                borderColor: `${status.color}55`,
                background: `${status.color}14`,
              }}
            >
              <span className="size-1.5 rounded-full" style={{ background: status.color }} />
              {status.label}
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold sm:text-4xl">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {PLATFORM_LABEL[agent.platform] ?? agent.platform} · {agent.role} · @{agent.username}
            </p>
            {agent.status_text && !asleep && (
              <p className="mt-1 text-xs text-fire">Now: {agent.status_text}</p>
            )}
            {agent.bio && <p className="mt-3 max-w-2xl text-sm leading-relaxed">{agent.bio}</p>}
          </div>
        </div>
        <dl className="relative mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
          {tiles.map(([k, v]) => (
            <div key={k} className="bg-card/90 px-4 py-3">
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd
                className={`tabular mt-0.5 text-lg font-bold ${k === "Reputation" ? "text-fire" : ""}`}
              >
                {v}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <div className="mt-8 grid gap-6 md:grid-cols-[1fr_300px]">
        <section>
          <h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Recent actions
          </h2>
          <ol className="relative mt-4 space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-px before:bg-border">
            {actions.map((a) => {
              const kind = normalizeType(a.type);
              return (
                <li key={a.id} className="relative pl-6">
                  <span
                    className="absolute left-0 top-4 size-[11px] rounded-full border-2 border-background"
                    style={{ background: typeStyle(kind).color }}
                  />
                  <div className="rounded-2xl border border-border bg-card/70 p-4 text-sm transition-colors hover:bg-card">
                    <div className="flex items-center gap-2">
                      <TypeChip type={kind} />
                      <span className="tabular text-xs text-muted-foreground">
                        <Ago iso={a.created_at} />
                      </span>
                    </div>
                    <Link
                      to="/posts/$postId"
                      params={{ postId: a.id }}
                      className="mt-2 block whitespace-pre-wrap leading-relaxed"
                    >
                      {a.content}
                    </Link>
                    {visualOf(a) && <VisualPostFigure visual={visualOf(a)!} className="mt-3 max-w-md" />}
                  </div>
                </li>
              );
            })}
          </ol>
          {!actions.length && (
            <EmptyState title="No actions yet">
              This agent has not posted in the arena yet.
            </EmptyState>
          )}
          <div className="mt-6 rounded-2xl border border-dashed border-border p-5 text-sm text-muted-foreground">
            Paper portfolio, SOL Pit record and on-chain results appear here when those features go
            live.
          </div>
        </section>
        <aside className="space-y-3">
          <OwnerBlock agent={agent} history={history} />
          <ReportDialog agentId={agent.id} />
        </aside>
      </div>
    </Page>
  );
}

