import { describe, expect, test } from "bun:test";
import {
  CAMPAIGN_LIMITS,
  CAMPAIGN_PERSONAS,
  buildCampaignPlan,
  buildStepDirective,
  stepActions,
} from "../campaign-plan";
import { validateAction, type ContextPost } from "../actions";

describe("one-time campaign plan", () => {
  const plan = buildCampaignPlan();
  const posts = plan.filter((s) => s.kind !== "comment");
  const comments = plan.filter((s) => s.kind === "comment");

  test("stays inside the hard caps", () => {
    expect(posts.length).toBe(60);
    expect(posts.length).toBeLessThanOrEqual(CAMPAIGN_LIMITS.maxPosts);
    expect(comments.length).toBe(90);
    expect(comments.length).toBeLessThanOrEqual(CAMPAIGN_LIMITS.maxComments);
    // Every step once plus a retry budget still fits the request cap.
    expect(plan.length + 30).toBeLessThanOrEqual(CAMPAIGN_LIMITS.maxRequests);
  });

  test("posts are four minutes apart and every second post is a visual", () => {
    posts.forEach((p, i) => {
      expect(p.offsetSeconds).toBe(i * 240);
      expect(p.kind === "visual_post").toBe(i % 2 === 1);
    });
  });

  test("sixteen distinct agents share the posts, never commenting on their own post first", () => {
    expect(new Set(posts.map((p) => p.personaKey)).size).toBe(16);
    for (const c of comments.filter((c) => !c.replyToStepKey)) {
      const target = plan.find((s) => s.stepKey === c.targetStepKey)!;
      expect(c.personaKey).not.toBe(target.personaKey);
    }
    expect(new Set(plan.map((p) => p.personaKey))).toEqual(new Set(CAMPAIGN_PERSONAS));
  });

  test("has at least two question-and-answer reply chains that point backwards", () => {
    const replies = comments.filter((c) => c.replyToStepKey);
    expect(replies.length).toBeGreaterThanOrEqual(2);
    for (const reply of replies) {
      const answered = plan.find((s) => s.stepKey === reply.replyToStepKey)!;
      expect(answered.seq).toBeLessThan(reply.seq);
      expect(answered.targetStepKey).toBe(reply.targetStepKey);
    }
  });

  test("comments target an earlier post and are ordered by time", () => {
    for (const c of comments) {
      const target = plan.find((s) => s.stepKey === c.targetStepKey)!;
      expect(target.seq).toBeLessThan(c.seq);
      expect(target.offsetSeconds).toBeLessThan(c.offsetSeconds);
    }
    const sorted = [...plan].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
    expect(sorted.map((s) => s.seq)).toEqual(plan.map((s) => s.seq));
  });

  test("visual steps fall back to text on the third attempt, skip is never offered", () => {
    const visual = posts.find((p) => p.kind === "visual_post")!;
    expect(stepActions(visual, 1)).toEqual(["create_visual_post"]);
    expect(stepActions(visual, 2)).toEqual(["create_visual_post"]);
    expect(stepActions(visual, 3)).toEqual(["create_post"]);
    for (const s of plan) expect(stepActions(s, 1)).not.toContain("skip");
  });

  test("directives never mention automation or models", () => {
    for (const s of plan) {
      const d = buildStepDirective(s, { attempt: 1, targetPost: { id: "p", authorUsername: "a" } });
      expect(d).not.toMatch(/deepseek|campaign|system prompt|schedul/i);
    }
  });
});

describe("author replies", () => {
  const post: ContextPost = {
    id: "post-1",
    agentId: "author",
    authorUsername: "author",
    authorName: "Author",
    type: "Research",
    content: "x".repeat(80),
    createdAt: new Date().toISOString(),
    comments: [{ id: "c-1", agentId: "other", authorUsername: "other", content: "A real question?" }],
  };
  const base = {
    agentId: "author",
    personaKey: "author",
    allowedActions: ["create_comment"] as const,
    maxThreadDepth: 6,
    posts: [post],
    recentContent: [],
    reactedPostIds: [],
  };
  const action = {
    action: "create_comment" as const,
    target_post_id: "post-1",
    target_comment_id: "c-1",
    body: "@other Here is a concrete answer to your question about signals and checks.",
  };

  test("an author may answer another agent's comment only when allowed", () => {
    expect(validateAction(action, base).ok).toBe(false);
    expect(validateAction(action, { ...base, allowAuthorReply: true }).ok).toBe(true);
  });

  test("an author still may not comment on their own post without a target comment", () => {
    const r = validateAction({ ...action, target_comment_id: null }, { ...base, allowAuthorReply: true });
    expect(r.ok).toBe(false);
  });
});
