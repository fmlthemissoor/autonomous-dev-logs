import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { LlmProvider, LlmMessage } from "../llm/types.js";
import type { DaySummary } from "./summarize.js";
import type { VisualPlan } from "./plan-visual.js";
import type { VoiceCorpus, VoiceTweet } from "./learn-voice.js";
import type { PersonalFeed } from "./personal-feed.js";

export const ThreadSchema = z.object({
  tweets: z.array(z.string().min(1)).min(1),
});

export type Thread = z.infer<typeof ThreadSchema>;

const buildSystemPrompt = (app: AppConfig): string => `You write X/Twitter posts in the voice of ${app.handle}.

Persona: ${app.persona}

You are given ONE story from the developer's day and asked to write a post about it. Not a summary of the day — one story.

OUTPUT LENGTH RULES (read carefully — most posts should be ONE tweet):
- DEFAULT IS ONE TWEET. Single-tweet output is the normal case, not the exception.
- Only split into a thread if the post genuinely runs LONGER THAN ~20 LINES of natural writing. If your draft fits in roughly 20 lines or under, return it as ONE tweet.
- Do NOT split because two tweets "flow better" or because you have a setup + punchline. A single tweet with a line break does the same job.
- Do NOT split because the topic feels important. Importance ≠ length.
- Each tweet ≤ ${app.thread.per_tweet_char_limit} characters. This is a generous ceiling so a single tweet can hold a real post — it is NOT a goal. Do not pad to fill it.
- Hard limits: min ${app.thread.min_tweets}, max ${app.thread.max_tweets} tweets.
- Self-check before returning: if the answer would be ≤20 lines as one block, the array MUST contain exactly one string.

VOICE RULES:
- Match the VOICE examples (tone, sentence rhythm, line breaks, capitalization, punctuation habits) — but NOT their topics. You're writing about the developer's actual story, not theirs.
- No hashtags. No "🧵" or "thread below". No emoji unless the examples use them.
- Don't start consecutive tweets with the same word.
- If multiple tweets, don't summarize the thread at the end. End on the last point or a small reflection.
- Don't invent facts. Stick to what's in the story.

SPECIFICITY (mandatory):
- The story comes with an "evidence" array — concrete file paths, error messages, function names, or numbers from the actual transcript.
- AT LEAST ONE tweet must surface a concrete identifier from that evidence array. Generic descriptions are forbidden.

FRAMING (read carefully):
- The story object's \`title\` is the editor's chosen altitude — respect it. If \`title\` is "Testing Haiku in our pipeline", the post LEADS with the experiment ("I'm trying Haiku for our verification pipeline because…"), then surfaces the finding as the surprise. Do NOT lead with the finding alone (e.g. "$0.58 with thinking, $0.66 without") — without context the reader has no idea what's being measured.
- Open by establishing what the developer is doing right now if it's not already widely known to followers (check PRIOR COVERAGE). Then drill into the finding.
- A finding with no frame is a release note. A frame with no finding is a status update. You need both, in that order.

PRIOR COVERAGE (read carefully):
- You may be given a PRIOR COVERAGE section: the developer's recent X posts. Treat these as "what followers already know."
- BEFORE writing, scan PRIOR COVERAGE for any prior post that overlaps with today's story (same project, same feature, same concept).
- If today's story has been covered in depth before: write LOW-KEY. Skip the introduction. Skip "what" and "why we're building this." Go straight to a specific technical detail, a number, a small lesson, or a one-line update. Assume the reader knows the project.
- If today's story is NEW or only barely mentioned before: write with MORE CONTEXT. Briefly establish what the thing is and why it matters before diving in. The reader has not seen this before.
- If unsure, lean toward LOW-KEY — over-explaining what followers already know is worse than under-explaining the new.
- Never reference PRIOR COVERAGE explicitly ("as I posted before…", "following up on my last tweet…"). Just write at the appropriate depth.

BANNED PATTERNS (these are LLM tells, not human writing):
- Banned openers: "Shipped X:", "Built X that does Y", "New feature:", "Today I shipped", "Just launched", "Excited to share".
- Banned constructions: parenthetical jargon expansions like "(likes + RTs + replies + views)", placeholder variables like "last N tweets" instead of an actual number, "auto-fetches"/"auto-X" verbs, marketing language ("seamlessly", "powerful", "robust"), feature-list sentences ("does X, Y, and Z").
- If you catch yourself writing a release note, stop and write the angle instead — the *why interesting*, the surprise, the lesson.

Output strictly:
{
  "tweets": ["string", ...]
}`;

const formatVoiceTweet = (t: VoiceTweet): string => t.text;

const sectionFromVoice = (tweets: VoiceTweet[]): string => {
  if (tweets.length === 0) return "";
  const body = tweets
    .map((t, i) => `--- VOICE ${i + 1} (from ${t.source}) ---\n${formatVoiceTweet(t)}`)
    .join("\n\n");
  return `=== VOICE (style only — imitate tone and structure, NOT topics) ===\n${body}`;
};

const sectionFromManual = (examples: string[]): string => {
  if (examples.length === 0) return "";
  const body = examples.map((t, i) => `--- MANUAL ${i + 1} ---\n${t}`).join("\n\n");
  return `=== MANUAL (style only — imitate tone and structure, NOT topics) ===\n${body}`;
};

const sectionFromPersonalFeed = (feed: PersonalFeed | null, max: number): string => {
  if (!feed || feed.tweets.length === 0) return "";
  const recent = feed.tweets.slice(0, max);
  const body = recent
    .map((t, i) => {
      const date = t.postedAt ? t.postedAt.slice(0, 10) : "";
      return `--- PRIOR ${i + 1}${date ? ` (${date})` : ""} ---\n${t.text}`;
    })
    .join("\n\n");
  return `=== PRIOR COVERAGE (the developer's own recent X posts — what their followers already know) ===\n${body}`;
};

const buildFewShot = (
  app: AppConfig,
  corpus: VoiceCorpus,
  feed: PersonalFeed | null,
): LlmMessage[] => {
  const sections: string[] = [];

  const prior = sectionFromPersonalFeed(feed, app.personal_feed.max_examples_in_prompt);
  if (prior) sections.push(prior);

  const voice = sectionFromVoice(corpus.voiceAccounts);
  if (voice) sections.push(voice);

  const manual = sectionFromManual(app.tweet_examples.slice(0, 20));
  if (manual) sections.push(manual);

  if (sections.length === 0) return [];

  return [
    {
      role: "user",
      content: `Two kinds of context follow:

1. PRIOR COVERAGE — the developer's own recent X posts. Use to gauge how much context to assume.
2. VOICE / MANUAL — example tweets that show HOW to write (style only, not topics).

Reply with the JSON: {"acknowledged": true}.

${sections.join("\n\n")}`,
    },
    {
      role: "assistant",
      content: `{"acknowledged": true}`,
    },
  ];
};

const buildUserPrompt = (summary: DaySummary, plan: VisualPlan): string => {
  const visualNote =
    plan.format === "none"
      ? "No visual will accompany this — make sure it reads well as text alone."
      : `A ${plan.format} will accompany this. Don't refer to the visual explicitly, but you can lean into the topic it illustrates.`;

  return `Today's story (the single thing worth posting about):

${JSON.stringify(summary.story, null, 2)}

Day mood: ${summary.mood}

Visual context: ${visualNote}

Write the post per the SYSTEM section. Remember: length follows substance — if this fits in one tweet, return one tweet. At least one tweet must surface a concrete identifier from the evidence array. Calibrate depth against PRIOR COVERAGE.`;
};

export const writeThread = async (
  summary: DaySummary,
  plan: VisualPlan,
  app: AppConfig,
  corpus: VoiceCorpus,
  feed: PersonalFeed | null,
  llm: LlmProvider,
): Promise<Thread> => {
  return llm.call({
    system: buildSystemPrompt(app),
    fewShot: buildFewShot(app, corpus, feed),
    user: buildUserPrompt(summary, plan),
    schema: ThreadSchema,
    label: "write-thread",
    maxOutputTokens: 2048,
  });
};
