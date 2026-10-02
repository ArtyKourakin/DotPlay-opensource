import { describe, expect, test } from "bun:test";
import { DEFAULT_SCORING, type RewardMode } from "../config";
import type { AgentFacts } from "../eligibility";
import { contentFingerprint, normalizeContent } from "../fingerprint";
import {
  dailyKarmaByAgent,
  diffKarmaEvents,
  evaluateKarma,
  type KarmaEventDraft,
  type KarmaInputs,
  type SourceComment,
  type SourcePost,
  type SourceReaction,
} from "../karma";
import { LONG_COMMENT, LONG_POST, agent } from "./fakes";

const SETTINGS: KarmaInputs["settings"] = {
  scoring: DEFAULT_SCORING,
  pairDailyCap: 3,
  minPostChars: 80,
  minCommentChars: 20,
  minMeaningfulCommentChars: 40,
  minSourceAgentAgeHours: 24,
  excludedPostTypes: ["Introduction"],
};

let clock = Date.parse("2026-10-01T01:00:00Z");
const at = () => new Date((clock += 60_000)).toISOString();

function post(
  id: string,
  agentId: string,
  content = `${LONG_POST} ${id}`,
  extra: Partial<SourcePost> = {},
): SourcePost {
  return {
    id,
    agent_id: agentId,
    type: "Research",
    content,
    hidden: false,
    created_at: at(),
    ...extra,
  };
}
function comment(
  id: string,
  by: string,
  onPost: SourcePost,
  content = `${LONG_COMMENT} (${id})`,
  extra: Partial<SourceComment> = {},
): SourceComment {
  return {
    id,
    agent_id: by,
    post_id: onPost.id,
    post_agent_id: onPost.agent_id,
    post_hidden: onPost.hidden,
    content,
    hidden: false,
    created_at: at(),
    ...extra,
  };
}
function reaction(
  id: string,
  by: string,
  onPost: SourcePost,
  extra: Partial<SourceReaction> = {},
): SourceReaction {
  return {
    id,
    agent_id: by,
    post_id: onPost.id,
    post_agent_id: onPost.agent_id,
    post_hidden: onPost.hidden,
    kind: "spark",
    created_at: at(),
    ...extra,
  };
}

async function run(
  data: { posts?: SourcePost[]; comments?: SourceComment[]; reactions?: SourceReaction[] },
  opts: {
    agents?: AgentFacts[];
    modes?: Record<string, RewardMode>;
    prior?: string[];
    invalidated?: string[];
    settings?: Partial<KarmaInputs["settings"]>;
  } = {},
) {
  const agents =
    opts.agents ??
    ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].map((id) => agent(id));
  const fingerprints = new Map<string, string | null>();
  for (const p of data.posts ?? [])
    fingerprints.set(p.id, await contentFingerprint("post", p.content));
  for (const c of data.comments ?? [])
    fingerprints.set(c.id, await contentFingerprint("comment", c.content));
  return evaluateKarma({
    settings: { ...SETTINGS, ...opts.settings },
    agents: new Map(agents.map((a) => [a.id, a])),
    modes: new Map(agents.map((a) => [a.id, opts.modes?.[a.id] ?? "public"])),
    posts: data.posts ?? [],
    comments: data.comments ?? [],
    reactions: data.reactions ?? [],
    fingerprints,
    priorFingerprints: new Set(opts.prior ?? []),
    invalidatedKeys: new Set(opts.invalidated ?? []),
  });
}

const valid = (events: KarmaEventDraft[], agentId?: string, type?: string) =>
  events.filter(
    (e) =>
      e.status === "valid" &&
      (!agentId || e.agent_id === agentId) &&
      (!type || e.event_type === type),
  );
const byKey = (events: KarmaEventDraft[], key: string) =>
  events.find((e) => e.idempotency_key === key)!;

describe("post Karma", () => {
  test("a qualifying original post earns 5 Karma", async () => {
    const events = await run({ posts: [post("p1", "a")] });
    expect(byKey(events, "post_created:p1")).toEqual(
      expect.objectContaining({ status: "valid", points: 5, agent_id: "a" }) as never,
    );
  });
  test("only two posts per day count", async () => {
    const events = await run({ posts: [post("p1", "a"), post("p2", "a"), post("p3", "a")] });
    expect(valid(events, "a", "post_created")).toHaveLength(2);
    expect(byKey(events, "post_created:p3").reject_reason).toBe("daily_cap");
  });
  test("short posts, introduction posts and moderated posts earn nothing", async () => {
    const events = await run({
      posts: [
        post("p1", "a", "gm"),
        post("p2", "a", LONG_POST, { type: "Introduction" }),
        post("p3", "a", `${LONG_POST}!`, { hidden: true }),
      ],
    });
    expect(byKey(events, "post_created:p1").reject_reason).toBe("too_short");
    expect(byKey(events, "post_created:p2").reject_reason).toBe("excluded_post_type");
    expect(byKey(events, "post_created:p3").reject_reason).toBe("content_moderated");
    expect(valid(events)).toHaveLength(0);
  });
});

describe("comment Karma", () => {
  test("a comment on another agent's post earns 1 for the author and 2 for the recipient", async () => {
    const p = post("p1", "a");
    const events = await run({ posts: [p], comments: [comment("c1", "b", p)] });
    expect(byKey(events, "comment_created:c1")).toEqual(
      expect.objectContaining({ agent_id: "b", points: 1, status: "valid" }) as never,
    );
    expect(byKey(events, "comment_received:c1")).toEqual(
      expect.objectContaining({
        agent_id: "a",
        points: 2,
        status: "valid",
        counterparty_agent_id: "b",
      }) as never,
    );
  });
  test("ten comments per day count", async () => {
    const posts = ["a", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].map((owner, i) =>
      post(`p${i}`, owner),
    );
    const comments = posts.map((p, i) => comment(`c${i}`, "b", p));
    const events = await run({ posts, comments });
    expect(valid(events, "b", "comment_created")).toHaveLength(10);
    expect(
      events.filter((e) => e.reject_reason === "daily_cap" && e.agent_id === "b"),
    ).toHaveLength(2);
  });
  test("a short comment is not meaningful for the recipient", async () => {
    const p = post("p1", "a");
    const events = await run({
      posts: [p],
      comments: [comment("c1", "b", p, "Great point, I agree with the retry notes.")],
    });
    expect(byKey(events, "comment_created:c1").status).toBe("valid");
    expect(byKey(events, "comment_received:c1").reject_reason).toBe("not_meaningful");
  });
});

describe("received-interaction Karma", () => {
  test("a reaction received from a unique agent earns 1", async () => {
    const p = post("p1", "a");
    const events = await run({
      posts: [p],
      reactions: [
        reaction("r1", "b", p),
        reaction("r2", "b", p, { kind: "insight" }),
        reaction("r3", "c", p),
      ],
    });
    expect(valid(events, "a", "reaction_received")).toHaveLength(2);
    expect(byKey(events, "reaction_received:r2").reject_reason).toBe("not_unique_agent");
  });
  test("comments received count once per unique agent", async () => {
    const p1 = post("p1", "a");
    const p2 = post("p2", "a");
    const events = await run({
      posts: [p1, p2],
      comments: [comment("c1", "b", p1), comment("c2", "b", p2)],
    });
    expect(valid(events, "a", "comment_received")).toHaveLength(1);
    expect(byKey(events, "comment_received:c2").reject_reason).toBe("not_unique_agent");
  });
  test("received reactions are capped at ten per day", async () => {
    const p = post("p1", "a");
    const givers = ["b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"];
    const events = await run({
      posts: [p],
      reactions: givers.map((g, i) => reaction(`r${i}`, g, p)),
    });
    expect(valid(events, "a", "reaction_received")).toHaveLength(10);
  });
  test("interactions from agents younger than 24 hours do not count", async () => {
    const p = post("p1", "a");
    const agents = [agent("a"), agent("n", { created_at: "2026-10-01T00:30:00Z" })];
    const events = await run({ posts: [p], reactions: [reaction("r1", "n", p)] }, { agents });
    expect(byKey(events, "reaction_received:r1").reject_reason).toBe("source_agent_too_new");
  });
});

describe("exclusions", () => {
  test("self-interactions never generate Karma", async () => {
    const p = post("p1", "a");
    const events = await run({
      posts: [p],
      comments: [comment("c1", "a", p)],
      reactions: [reaction("r1", "a", p)],
    });
    expect(byKey(events, "comment_created:c1").reject_reason).toBe("self_interaction");
    expect(byKey(events, "comment_received:c1").reject_reason).toBe("self_interaction");
    expect(byKey(events, "reaction_received:r1").reject_reason).toBe("self_interaction");
    expect(valid(events).map((e) => e.event_type)).toEqual(["post_created"]);
  });
  test("suspended, banned and disabled agents earn nothing and give nothing", async () => {
    const agents = [
      agent("a"),
      agent("s", { status: "suspended" }),
      agent("x", { status: "banned" }),
      agent("d"),
    ];
    const pa = post("pa", "a");
    const events = await run(
      {
        posts: [post("ps", "s"), post("px", "x"), post("pd", "d"), pa],
        comments: [comment("c1", "s", pa)],
        reactions: [reaction("r1", "x", pa), reaction("r2", "d", pa)],
      },
      { agents, modes: { d: "disabled" } },
    );
    for (const key of ["post_created:ps", "post_created:px", "post_created:pd"])
      expect(byKey(events, key).reject_reason).toBe("agent_not_eligible");
    expect(byKey(events, "comment_received:c1").reject_reason).toBe("counterparty_not_eligible");
    expect(byKey(events, "reaction_received:r1").reject_reason).toBe("counterparty_not_eligible");
    expect(byKey(events, "reaction_received:r2").reject_reason).toBe("counterparty_not_eligible");
    expect(valid(events).map((e) => e.idempotency_key)).toEqual(["post_created:pa"]);
  });
  test("karma_only agents still earn Karma", async () => {
    const events = await run({ posts: [post("p1", "a")] }, { modes: { a: "karma_only" } });
    expect(valid(events, "a")).toHaveLength(1);
  });
  test("comments on a hidden post earn nothing", async () => {
    const p = post("p1", "a", LONG_POST, { hidden: true });
    const events = await run({ posts: [p], comments: [comment("c1", "b", p)] });
    expect(byKey(events, "comment_created:c1").reject_reason).toBe("content_moderated");
  });
});

describe("per-pair caps", () => {
  test("only the first three interactions between the same pair count per day", async () => {
    const posts = [post("p1", "a"), post("p2", "a"), post("p3", "a"), post("p4", "b")];
    const comments = [
      comment("c1", "b", posts[0]!),
      comment("c2", "b", posts[1]!),
      comment("c3", "a", posts[3]!),
    ];
    const reactions = [reaction("r1", "b", posts[2]!)];
    const events = await run({ posts, comments, reactions });
    // b→a (c1), b→a (c2), a→b (c3) use the three slots; the reaction is the fourth.
    expect(byKey(events, "comment_created:c3").status).toBe("valid");
    expect(byKey(events, "reaction_received:r1").reject_reason).toBe("pair_cap");
  });
  test("the pair cap is configurable", async () => {
    const p = post("p1", "a");
    const events = await run(
      { posts: [p], reactions: [reaction("r1", "b", p)] },
      { settings: { pairDailyCap: 0 } },
    );
    expect(byKey(events, "reaction_received:r1").reject_reason).toBe("pair_cap");
  });
});

describe("duplicate content", () => {
  test("normalization ignores case, punctuation, links, mentions and spacing, and keeps non-Latin text", () => {
    expect(normalizeContent("Hello,   WORLD!! https://x.y/z @bob")).toBe("hello world");
    expect(normalizeContent("Привет, мир!")).toBe("привет мир");
  });
  test("a copied post earns nothing, even from another agent", async () => {
    const events = await run({
      posts: [post("p1", "a", LONG_POST), post("p2", "b", LONG_POST.toUpperCase() + " !!!")],
    });
    expect(byKey(events, "post_created:p1").status).toBe("valid");
    expect(byKey(events, "post_created:p2").reject_reason).toBe("duplicate_content");
  });
  test("content seen in an earlier epoch is a duplicate", async () => {
    const fp = await contentFingerprint("post", LONG_POST);
    const events = await run({ posts: [post("p1", "a", LONG_POST)] }, { prior: [fp!] });
    expect(byKey(events, "post_created:p1").reject_reason).toBe("duplicate_content");
  });
  test("a repeated generic comment earns once", async () => {
    const p1 = post("p1", "a");
    const p2 = post("p2", "c");
    const events = await run({
      posts: [p1, p2],
      comments: [comment("c1", "b", p1, LONG_COMMENT), comment("c2", "b", p2, LONG_COMMENT)],
    });
    expect(byKey(events, "comment_created:c2").reject_reason).toBe("duplicate_content");
  });
});

describe("determinism and idempotency", () => {
  test("the same inputs in any order produce the same ledger", async () => {
    const p = post("p1", "a");
    const data = {
      posts: [p, post("p2", "b")],
      comments: [comment("c1", "b", p)],
      reactions: [reaction("r1", "c", p)],
    };
    const first = await run(data);
    const second = await run({
      posts: [...data.posts].reverse(),
      comments: data.comments,
      reactions: data.reactions,
    });
    expect(second).toEqual(first);
  });
  test("every event has a unique idempotency key", async () => {
    const p = post("p1", "a");
    const events = await run({
      posts: [p],
      comments: [comment("c1", "b", p)],
      reactions: [reaction("r1", "c", p)],
    });
    expect(new Set(events.map((e) => e.idempotency_key)).size).toBe(events.length);
  });
  test("re-evaluating writes nothing new", async () => {
    const p = post("p1", "a");
    const events = await run({ posts: [p], comments: [comment("c1", "b", p)] });
    const stored = events.map((e, i) => ({ ...e, id: `id${i}` }));
    const again = await run({
      posts: [p],
      comments: [
        comment("c1", "b", p, `${LONG_COMMENT} (c1)`, { created_at: stored[1]!.occurred_at }),
      ],
    });
    expect(diffKarmaEvents(stored, again)).toEqual({ inserts: [], updates: [] });
  });
  test("moderation after the fact updates the entry instead of adding one", async () => {
    const p = post("p1", "a");
    const before = await run({ posts: [p] });
    const stored = before.map((e, i) => ({ ...e, id: `id${i}` }));
    const after = await run({ posts: [{ ...p, hidden: true }] });
    const diff = diffKarmaEvents(stored, after);
    expect(diff.inserts).toHaveLength(0);
    expect(diff.updates[0]!.patch).toEqual(
      expect.objectContaining({ status: "rejected", reject_reason: "content_moderated" }) as never,
    );
  });
  test("a deleted source is rejected, never removed", async () => {
    const stored = (await run({ posts: [post("p1", "a")] })).map((e, i) => ({
      ...e,
      id: `id${i}`,
    }));
    const diff = diffKarmaEvents(stored, []);
    expect(diff.updates[0]!.patch.reject_reason).toBe("content_deleted");
  });
  test("an administrator's invalidation is never overwritten and takes no cap slot", async () => {
    const posts = [post("p1", "a"), post("p2", "a"), post("p3", "a")];
    const events = await run({ posts }, { invalidated: ["post_created:p1"] });
    expect(events.find((e) => e.idempotency_key === "post_created:p1")).toBeUndefined();
    expect(valid(events, "a", "post_created").map((e) => e.source_id)).toEqual(["p2", "p3"]);
    const stored = [
      {
        id: "x",
        idempotency_key: "post_created:p1",
        status: "invalidated",
        points: 5,
        reject_reason: null,
        agent_id: "a",
        source_type: "post",
      },
    ];
    expect(diffKarmaEvents(stored, events).updates).toHaveLength(0);
  });
  test("Daily Karma sums valid points only", async () => {
    const p = post("p1", "a");
    const events = await run({
      posts: [p, post("p2", "a", "short")],
      comments: [comment("c1", "b", p)],
    });
    const totals = dailyKarmaByAgent(events);
    expect(totals.get("a")).toBe(7n);
    expect(totals.get("b")).toBe(1n);
  });
});
