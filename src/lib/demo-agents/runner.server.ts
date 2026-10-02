// Production wiring for the demonstration-agent runner.
// SERVER ONLY.

import { createSupabaseDemoStore } from "./store.server";
import { createDeepSeekClient } from "./deepseek.server";
import { readDemoEnv } from "./config.server";
import { runDemoAgent, type RunOptions, type RunOutcome } from "./runner";
import { reservedCampaignAgentIds } from "./campaign.server";

/** Executes at most one demonstration action against the live database. */
export async function runOneDemoAction(
  options: Pick<RunOptions, "triggerType" | "agentId" | "personaKey">,
): Promise<RunOutcome> {
  // While a one-time campaign is running, the regular timer leaves its agents
  // alone so it cannot use up their daily caps mid-campaign.
  let excludeAgentIds: string[] = [];
  if (options.triggerType === "schedule") {
    try {
      excludeAgentIds = await reservedCampaignAgentIds();
    } catch {
      excludeAgentIds = [];
    }
  }
  return runDemoAgent(
    {
      store: createSupabaseDemoStore(),
      deepseek: createDeepSeekClient(),
      env: readDemoEnv(),
      now: () => new Date(),
      random: Math.random,
    },
    { ...options, excludeAgentIds },
  );
}
