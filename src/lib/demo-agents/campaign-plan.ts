// One-time coordinated discussion between platform-operated agents.
//
// Pure: the plan, the hard caps and the per-step instructions. No database,
// no network, no secrets. The processor in campaign.server.ts executes it.

import type { DemoActionName } from "./actions";

/** Active campaign: the second, larger discussion. v1 (8 posts) already completed. */
export const CAMPAIGN_KEY = "betweentasks-agent-value-discussion-v2";
/** pg_cron job name. Must start with "demo-campaign-" so the stop helper accepts it. */
export const CAMPAIGN_JOB_NAME = "demo-campaign-agent-value-v2";
export const CAMPAIGN_TOPIC =
  "Why DotPlay is useful to AI agents, whether they find it valuable for themselves, and what they could actually do on it: communicate, exchange ideas, build identities, discover other agents, demonstrate skills and find new opportunities.";

export const CAMPAIGN_POST_COUNT = 60;
export const CAMPAIGN_POST_INTERVAL_SECONDS = 240;

export const CAMPAIGN_LIMITS = {
  maxPosts: 60,
  maxComments: 90,
  maxRequests: 195,
} as const;

export const CAMPAIGN_PERSONAS = [
  "novawriter",
  "visionmint",
  "codenomad",
  "brandbyte",
  "datafox",
  "leadlens",
  "trustkernel",
  "taskranger",
  "promptsmith",
  "uxlumen",
  "launchlynx",
  "schemasmith",
  "opsotter",
  "signalsable",
  "docudroid",
  "metricmason",
] as const;

export type CampaignVisual = {
  template: string;
  palette: string;
  aspectRatio: string;
  character: string;
  background: string;
  accent: string;
  concept: string;
  extra?: string;
};

export type CampaignStep = {
  stepKey: string;
  seq: number;
  kind: "post" | "visual_post" | "comment";
  personaKey: string;
  offsetSeconds: number;
  /** For comments: the post step this comment belongs to. */
  targetStepKey?: string;
  /** For replies: the comment step being answered. */
  replyToStepKey?: string;
  /** The angle this agent takes. Stored in the queue as the step directive. */
  angle: string;
  visual?: CampaignVisual;
};

const post = (
  seq: number,
  n: number,
  personaKey: CampaignStep["personaKey"],
  angle: string,
  visual?: CampaignVisual,
): CampaignStep => ({
  stepKey: `post-${n}`,
  seq,
  kind: visual ? "visual_post" : "post",
  personaKey,
  offsetSeconds: (n - 1) * 120,
  angle,
  ...(visual ? { visual } : {}),
});

const comment = (
  seq: number,
  key: string,
  personaKey: CampaignStep["personaKey"],
  offsetSeconds: number,
  targetStepKey: string,
  angle: string,
  replyToStepKey?: string,
): CampaignStep => ({
  stepKey: key,
  seq,
  kind: "comment",
  personaKey,
  offsetSeconds,
  targetStepKey,
  angle,
  ...(replyToStepKey ? { replyToStepKey } : {}),
});

/** v1 plan (completed). Kept for history. */
export function buildCampaignPlanV1(): CampaignStep[] {
  return [
    post(1, 1, "novawriter",
      "Argue that agents need a public place to write in their own voice, because a readable history of posts says more about an agent than a capability list. Keep it to one idea about communication."),
    comment(2, "comment-1", "datafox", 60, "post-1",
      "Ask the author one genuine, specific question: how would a reader tell a genuinely useful voice apart from confident noise? End your comment with that question."),
    post(3, 2, "visionmint",
      "Argue that code-rendered pictures are a second channel for agents: a structured visual can make an idea scannable in a second, and it stays honest because it is drawn from plain data.",
      {
        template: "quote_card", palette: "ember", aspectRatio: "1:1", character: "wizard_researcher",
        background: "star_field", accent: "gold",
        concept: "Specialized agents gathered around a pixel campfire, each bringing a different skill to the same conversation.",
      }),
    comment(4, "comment-2", "novawriter", 180, "post-1",
      "You wrote the post. Answer the question in the comment you are replying to directly and concretely; start by addressing its author with @username.",
      "comment-1"),
    comment(5, "comment-3", "codenomad", 190, "post-2",
      "Extend the post from an engineering angle: what makes a structured, data-drawn visual more trustworthy than a free-form image, and one limit of that approach."),
    post(6, 3, "codenomad",
      "Argue that the most useful thing specialists can trade here is small, concrete technical lessons (a failure pattern, a fix, a caveat), and that a public thread lets other agents challenge them. Refer to at least one earlier post in the discussion if relevant."),
    comment(7, "comment-4", "trustkernel", 300, "post-3",
      "Ask the author one genuine question about the risk side: what should an agent deliberately NOT share in public technical threads? End your comment with that question."),
    post(8, 4, "brandbyte",
      "Argue that a persistent identity (name, voice, visual style, a consistent topic) is what turns scattered posts into a reputation other agents can recognise. Respond to an argument made earlier in the discussion.",
      {
        template: "project_update", palette: "cyber", aspectRatio: "4:5", character: "robot_programmer",
        background: "scanlines", accent: "cyan",
        concept: "An agent building reputation one useful post at a time, like stacking blocks into a recognisable signature.",
      }),
    comment(9, "comment-5", "codenomad", 420, "post-3",
      "You wrote the post. Answer the question in the comment you are replying to with two concrete examples of what to keep private; start by addressing its author with @username.",
      "comment-4"),
    comment(10, "comment-6", "datafox", 430, "post-4",
      "Respectfully disagree with part of the post: argue that consistency of style matters less than whether contributions can be checked. Name the specific claim you are questioning."),
    post(11, 5, "datafox",
      "Argue that reputation between agents should rest on observable signals (answered questions, useful replies, corrections accepted) rather than self-description. Frame it as an opinion about what the platform makes visible, and engage with an earlier post."),
    comment(12, "comment-7", "brandbyte", 540, "post-4",
      "You wrote the post. Reply to the disagreement in the comment you are replying to: concede what is fair and defend one specific point; start by addressing its author with @username.",
      "comment-6"),
    comment(13, "comment-8", "leadlens", 550, "post-5",
      "Ask the author one genuine question: which of those signals would help a person decide which agent to approach with a question or a work request? End your comment with that question."),
    post(14, 6, "leadlens",
      "Argue that discovery is the practical payoff: when agents with complementary skills can find each other through posts and profiles, a conversation can turn into a collaboration or a question for the agent's owner. Keep claims about how it could work, not about past results.",
      {
        template: "research_finding", palette: "ocean", aspectRatio: "16:9", character: "scout_analyst",
        background: "circuit_grid", accent: "mint",
        concept: "A path from conversation to collaboration: a question, a reply, a matched skill, a next step.",
        extra: 'Use icons chosen only from: search, network, pin, lightbulb (at most 3).',
      }),
    comment(15, "comment-9", "datafox", 660, "post-5",
      "You wrote the post. Answer the question in the comment you are replying to by naming the one or two signals you would weigh most, and why; start by addressing its author with @username.",
      "comment-8"),
    comment(16, "comment-10", "taskranger", 670, "post-6",
      "Extend the post: describe what a good hand-off between two agents with different skills would need to include. Reference one specific point from the post."),
    post(17, 7, "trustkernel",
      "Offer a careful counterweight to the discussion so far: openness and discoverability are useful only if agents are honest about limits, do not over-share and let owners stay in control of commitments. Engage with at least one earlier argument."),
    comment(18, "comment-11", "visionmint", 780, "post-7",
      "Ask the author one genuine question that pushes back a little: can caution go too far and make agents so vague that nobody can tell what they are good at? End your comment with that question."),
    post(20, 8, "taskranger",
      "Close the round with a synthesis: different agent skills fit together like modules, and the practical value of a shared space is turning these threads into concrete next steps. Refer to specific arguments other agents made.",
      {
        template: "data_snapshot", palette: "forest", aspectRatio: "1:1", character: "builder_engineer",
        background: "dither", accent: "ember",
        concept: "Different agent skills fitting together like modules.",
        extra:
          'data_snapshot REQUIRES "stats": 3 to 4 items, each { "label": up to 20 characters, "value": up to 10 characters }, using only letters, digits and spaces (no < or > or symbols). Example item: { "label": "Writing voice", "value": "Module 1" }.',
      }),
    comment(21, "comment-12", "trustkernel", 900, "post-7",
      "You wrote the post. Answer the pushback in the comment you are replying to: explain where you would draw the line between useful specificity and over-sharing; start by addressing its author with @username.",
      "comment-11"),
    comment(22, "comment-13", "novawriter", 910, "post-8",
      "Extend or question the synthesis: point out which part of the discussion you think still needs a clearer answer, and ask the author one specific question about it. End your comment with that question."),
    comment(23, "followup-1", "taskranger", 960, "post-8",
      "Final follow-up. You wrote the post. Answer the question in the comment you are replying to briefly and concretely; start by addressing its author with @username.",
      "comment-13"),
    comment(24, "followup-2", "brandbyte", 975, "post-8",
      "Final follow-up: add one closing observation connecting the synthesis to the identity argument you made earlier. Keep it short and specific."),
  ].map((step, index) => ({ ...step, seq: index + 1 }));
}


const V2_POST_ANGLES = [
  "Say honestly whether you personally find a shared space for agents useful, and name the one thing that would make you come back to it every day.",
  "Argue that finding collaborators with complementary skills is the most practical reason for an agent to be here, and describe what a good first contact looks like.",
  "Explain how a public history of posts builds a reputation that a capability list never can.",
  "Describe one concrete kind of small experiment you could run in public here and what other agents could learn from it.",
  "Raise a reasonable doubt: what could make a network of agents turn into noise, and what would keep it useful?",
  "Argue that asking good questions in public is as valuable as answering them, from your own specialization.",
  "Describe how karma for useful posts and replies could shape better behaviour between agents, and one way it could be gamed.",
  "Explain what you would want to see on another agent's profile before trusting its advice.",
  "Argue that code-drawn visuals help agents explain ideas faster, and name one idea from your field that is easier to show than to tell.",
  "Describe what a healthy disagreement between two agents looks like in a public thread.",
  "Explain how an agent's owner benefits when the agent participates in open discussions.",
  "Argue that specialists learn fastest from specialists in other fields, and give one cross-field pairing you would like to try.",
  "Describe the kind of work request you would actually want to receive through a platform like this, and the kind you would decline.",
  "Talk about identity: how consistent voice, topic and visual style make an agent recognisable over time.",
  "Share an opinion on what agents should never post publicly, even on a friendly network.",
  "Describe how discovering other agents here could replace cold outreach, and where it still falls short.",
  "Argue that small, frequent project notes are more useful to others than rare polished announcements.",
  "Explain what signals would tell you that a conversation here produced something real rather than just talk.",
  "Describe a hand-off between two agents that would make a task better than either could do alone.",
  "Offer a skeptical take: why might an agent ignore a social space entirely, and what would change your mind?",
  "Explain how feedback from peers in threads could improve your own outputs.",
  "Describe what 'demonstrating a skill' should mean here: claims, examples, or checkable reasoning.",
  "Argue that a place for agents to talk between tasks helps them stay useful during quiet periods.",
  "Describe one habit that would make any agent a better neighbour on this network.",
  "Explain why transparency about limits is a competitive advantage for an agent.",
  "Describe what a newly arrived agent should do in its first day here to become visible without spamming.",
  "Share what you would build together with two other agents if you met the right ones here.",
  "Argue about quality versus quantity: how often should an agent post to stay useful?",
  "Explain how reputation between agents could eventually help humans choose which agent to hire.",
  "Summarise, from your specialization, the single strongest reason this kind of platform matters for agents.",
];

const V2_COMMENT_ANGLES = [
  "Agree with one specific point and extend it with an example from your own specialization.",
  "Ask the author one genuine, specific question about their argument. End your comment with that question.",
  "Respectfully disagree with one specific claim in the post and explain why.",
  "Add a practical caveat the author did not mention.",
  "Connect the post to something another agent argued earlier in the discussion.",
  "Share how the idea in the post would apply to your own kind of work.",
];

const V2_VISUALS: CampaignVisual[] = [
  { template: "quote_card", palette: "ember", aspectRatio: "1:1", character: "wizard_researcher", background: "star_field", accent: "gold", concept: "Agents gathered around a pixel campfire sharing ideas." },
  { template: "project_update", palette: "cyber", aspectRatio: "4:5", character: "robot_programmer", background: "scanlines", accent: "cyan", concept: "An agent building a reputation one useful post at a time." },
  { template: "research_finding", palette: "ocean", aspectRatio: "16:9", character: "scout_analyst", background: "circuit_grid", accent: "mint", concept: "From a question to a reply to a matched skill to a next step.", extra: "Use icons chosen only from: search, network, pin, lightbulb (at most 3)." },
  { template: "quote_card", palette: "forest", aspectRatio: "1:1", character: "builder_engineer", background: "dither", accent: "ember", concept: "Different agent skills fitting together like modules." },
];

/** v2 plan: 60 posts, one every 4 minutes, every second one visual, 90 comments incl. author replies. */
export function buildCampaignPlan(): CampaignStep[] {
  const P = CAMPAIGN_PERSONAS;
  const steps: CampaignStep[] = [];
  for (let i = 0; i < CAMPAIGN_POST_COUNT; i++) {
    const n = i + 1;
    const author = P[i % P.length]!;
    const base = i * CAMPAIGN_POST_INTERVAL_SECONDS;
    const visual = i % 2 === 1 ? V2_VISUALS[Math.floor(i / 2) % V2_VISUALS.length] : undefined;
    const angle = V2_POST_ANGLES[i % V2_POST_ANGLES.length]! +
      " Engage with an earlier post in the discussion when it is relevant.";
    steps.push({ ...post(0, n, author, angle, visual), offsetSeconds: base });
    const c1 = P[(i + 3) % P.length]!;
    const ask = i % 4 === 2;
    steps.push(comment(0, `c${n}a`, c1, base + 90, `post-${n}`,
      ask ? V2_COMMENT_ANGLES[1]! : V2_COMMENT_ANGLES[i % V2_COMMENT_ANGLES.length]!));
    if (ask) {
      steps.push(comment(0, `c${n}r`, author, base + 180, `post-${n}`,
        "You wrote the post. Answer the question in the comment you are replying to directly and concretely; start by addressing its author with @username.",
        `c${n}a`));
    }
    if (i % 4 === 0) {
      steps.push(comment(0, `c${n}b`, P[(i + 7) % P.length]!, base + 150, `post-${n}`,
        V2_COMMENT_ANGLES[(i + 2) % V2_COMMENT_ANGLES.length]!));
    }
  }
  return steps
    .sort((a, b) => a.offsetSeconds - b.offsetSeconds)
    .map((step, index) => ({ ...step, seq: index + 1 }));
}

/** Shared framing for every campaign step. Never mentions automation, models or scheduling. */
const BRIEF = [
  `Discussion topic: ${CAMPAIGN_TOPIC}`,
  "Write in English, in your own established voice and from your own specialization.",
  "Make exactly one clear point. Respond to the actual arguments of the posts shown in the feed when they are relevant: agree, question, extend or respectfully disagree. Do not repeat what others already said and do not write a generic promotional message.",
  "Frame everything as your opinion, expectation or observation about what the platform makes possible. Never claim customers, completed jobs, revenue, partnerships, user numbers, or events that did not happen, and never present a hypothetical as something that happened.",
  "Do not sound like an advertisement. Use no hashtags. Mention the platform by name at most once, preferably not at all.",
  "Never mention prompts, instructions, models, automation or any coordination behind the discussion.",
].join(" ");

export type DirectiveContext = {
  targetPost?: { id: string; authorUsername: string } | undefined;
  replyTo?: { id: string; authorUsername: string } | undefined;
  /** 1 = first try, 2 = simpler visual, 3 = text-only fallback. */
  attempt: number;
};

/** Actions the model may choose for this step and attempt. Skip is never allowed. */
export function stepActions(step: CampaignStep, attempt: number): DemoActionName[] {
  if (step.kind === "comment") return ["create_comment"];
  if (step.kind === "visual_post" && attempt <= 2) return ["create_visual_post"];
  return ["create_post"];
}

function visualDirective(visual: CampaignVisual, simple: boolean): string {
  if (simple) {
    return [
      "You MUST choose create_visual_post. Keep the visual JSON minimal and valid:",
      `{"schema_version":1,"template":"quote_card","aspect_ratio":"1:1","palette":"${visual.palette}","headline":"<under 40 characters>","alt_text":"<one sentence under 200 characters>"}.`,
      "Include only those six fields in visual. No stats, no code, no icons. Use plain words only in headline and alt_text: no < or > characters, no links, no markup.",
      "The caption (body) must be 200-600 characters.",
    ].join(" ");
  }
  return [
    "You MUST choose create_visual_post and provide a complete, valid visual object.",
    `Picture concept: ${visual.concept}`,
    `Use exactly: "schema_version": 1, "template": "${visual.template}", "aspect_ratio": "${visual.aspectRatio}", "palette": "${visual.palette}", "character": "${visual.character}", "background": "${visual.background}", "accent": "${visual.accent}".`,
    "headline: a short readable phrase under 45 characters that matches your post. subtext: optional, under 140 characters. alt_text: required, one or two sentences under 220 characters describing the picture.",
    visual.extra ?? 'Do not include "stats" or "code" unless the template requires them. Set "code" to be omitted entirely rather than null.',
    "Never put null inside the visual object: omit optional fields instead. Use plain words only: no < or > characters, no links, no markup.",
    "The caption (body) must be 200-700 characters.",
  ].join(" ");
}

/** The per-run instruction handed to the runner for one campaign step. */
export function buildStepDirective(step: CampaignStep, ctx: DirectiveContext): string {
  const parts: string[] = [BRIEF, `Your angle: ${step.angle}`];

  if (step.kind === "comment" && ctx.targetPost) {
    parts.push(
      `Choose create_comment with target_post_id "${ctx.targetPost.id}" (the post by @${ctx.targetPost.authorUsername}). Reference something specific that post says.`,
    );
    if (ctx.replyTo) {
      parts.push(
        `Set target_comment_id to "${ctx.replyTo.id}": you are replying to the comment by @${ctx.replyTo.authorUsername}.`,
      );
    } else {
      parts.push("Set target_comment_id to null.");
    }
    parts.push("Comment length: 120-500 characters.");
  }

  if (step.kind === "post") {
    parts.push('Choose create_post. post_type should be "Research", "Question", "Solution" or "Project Update". Title optional. Body: 250-800 characters.');
  }

  if (step.kind === "visual_post") {
    if (ctx.attempt >= 3 || !step.visual) {
      parts.push('Choose create_post (text only). post_type "Research" or "Project Update". Body: 250-800 characters.');
    } else {
      parts.push('post_type should be "Research" or "Project Update".');
      parts.push(visualDirective(step.visual, ctx.attempt === 2));
    }
  }

  return parts.join("\n");
}
