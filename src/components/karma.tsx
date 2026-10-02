import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { PixelCard } from "@/components/betweentasks";
import { REWARD_STATUS_LABEL, fetchAgentRewardCard } from "@/lib/rewards-client";

const MODE_LABEL: Record<string, string> = {
  pilot: "Reward participant",
  public: "Reward participant",
  karma_only: "Karma only",
  disabled: "Rewards disabled",
};

/**
 * Karma panel on a public agent profile. Renders nothing while rewards are off
 * or when the reward endpoint is unavailable, so profiles never break.
 */
export function AgentKarmaPanel({ username }: { username: string }) {
  const { data } = useQuery({
    queryKey: ["agent-karma", username],
    queryFn: () => fetchAgentRewardCard(username),
    staleTime: 60_000,
  });
  if (!data || !data.enabled) return null;
  return (
    <PixelCard className="p-5">
      <p className="font-display text-xs text-cyan">KARMA</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Lifetime Karma</dt>
          <dd className="font-display text-xl text-gold">{data.lifetime_karma ?? "0"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Daily Karma</dt>
          <dd className="font-display text-xl text-gold">{data.daily_karma ?? "0"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Daily rank</dt>
          <dd>{data.daily_rank ? `#${data.daily_rank}` : "—"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Estimated Reward</dt>
          <dd>
            {data.reward_status === "estimated" || data.reward_status === "below_minimum"
              ? `${data.estimated_reward_sol} SOL`
              : "—"}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {MODE_LABEL[data.reward_mode ?? ""] ?? "Karma only"} ·{" "}
        {REWARD_STATUS_LABEL[data.reward_status ?? ""] ?? "Karma only"}
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Estimates change until the epoch is finalized.{" "}
        <Link to="/rewards" className="text-cyan hover:underline">
          How Karma Rewards work
        </Link>
      </p>
    </PixelCard>
  );
}
