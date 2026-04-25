import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { LlmProvider, LlmMessage } from "../llm/types.js";
import type { DaySummary } from "./summarize.js";
import type { VisualPlan } from "./plan-visual.js";
import type { VoiceCorpus, LabeledTweet } from "./learn-voice.js";

export const ThreadSchema = z.object({
  tweets: z.array(z.string().min(1)).min(1),
});

export type Thread = z.infer<typeof ThreadSchema>;

const buildSystemPrompt = (app: AppConfig): string => `You write X/Twitter threads in the voice of ${app.handle}.

Persona: ${app.persona}

Rules:
- Each tweet ≤ ${app.thread.per_tweet_char_limit} characters (counting spaces and punctuation).
- Between ${app.thread.min_tweets} and ${app.thread.max_tweets} tweets total.
- The first tweet is a hook — concrete and specific, not a generic teaser.
- No hashtags. No emoji unless the example tweets use them. No "🧵". No "thread below".
- Match the existing style EXACTLY: line breaks, sentence length, how technical, how punchy.
- Don't start tweets with the same word in a row.
- Don't summarize the thread at the end. End on the last point or a small reflection.
- Don't invent facts. Stick to what's in the day summary.

You will be shown several CATEGORIES of example tweets:
- HIGH-PERFORMING: tweets I wrote that earned strong engagement. Lean into these patterns (hook style, sentence rhythm, length, what makes them land).
- LOW-PERFORMING: tweets I wrote that flopped. Treat these as anti-patterns — avoid the things they share.
- VOICE: tweets from accounts whose style I admire. Imitate tone and structure, NOT specific topics.
- MANUAL: hand-curated examples I added directly.

Identity weight: HIGH-PERFORMING > MANUAL > LOW-PERFORMING (as anti-pattern) > VOICE (style only). When the categories conflict on style, default to my own voice (HIGH-PERFORMING / MANUAL).

Output strictly:
{
  "tweets": ["string", "string", ...]
}`;

const formatLabeledTweet = (tweet: LabeledTweet): string => {
  if (!tweet.metrics) return tweet.text;
  const m = tweet.metrics;
  const views = m.views !== null ? `${m.views}v` : "no-views";
  return `[${m.likes}❤  ${m.retweets}🔁  ${m.replies}💬  ${views}]\n${tweet.text}`;
};

const sectionFromTweets = (label: string, tweets: LabeledTweet[]): string => {
  if (tweets.length === 0) return "";
  const body = tweets
    .map((t, i) => `--- ${label} ${i + 1} (from ${t.source}) ---\n${formatLabeledTweet(t)}`)
    .join("\n\n");
  return `=== ${label} ===\n${body}`;
};

const sectionFromManual = (label: string, examples: string[]): string => {
  if (examples.length === 0) return "";
  const body = examples.map((t, i) => `--- ${label} ${i + 1} ---\n${t}`).join("\n\n");
  return `=== ${label} ===\n${body}`;
};

const buildFewShot = (app: AppConfig, corpus: VoiceCorpus): LlmMessage[] => {
  const sections: string[] = [];

  const high = sectionFromTweets("HIGH-PERFORMING", corpus.highPerforming);
  if (high) sections.push(high);

  const low = sectionFromTweets("LOW-PERFORMING", corpus.lowPerforming);
  if (low) sections.push(low);

  // selfVoice covers the cold-start case: your own tweets when there aren't
  // enough originals to bucket. Treated as MANUAL-ish — your voice without labels.
  const selfV = sectionFromTweets("MANUAL (your recent originals)", corpus.selfVoice);
  if (selfV) sections.push(selfV);

  const voice = sectionFromTweets("VOICE", corpus.voiceAccounts);
  if (voice) sections.push(voice);

  // Always include manual examples — fallback if voice_learning is off, supplement otherwise.
  const manualLabel = corpus.highPerforming.length + corpus.selfVoice.length > 0
    ? "MANUAL (additional curated)"
    : "MANUAL";
  const manual = sectionFromManual(manualLabel, app.tweet_examples.slice(0, 20));
  if (manual) sections.push(manual);

  if (sections.length === 0) return [];

  return [
    {
      role: "user",
      content: `Here are categorized examples of tweets that should inform how you write. Reply with the JSON: {"acknowledged": true}.

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
      ? "No visual will accompany this thread — make sure it reads well as text alone."
      : `A ${plan.format} will accompany this thread. Don't refer to the visual explicitly in the tweets, but you can lean into the topic it illustrates.`;

  return `Today's structured summary:

${JSON.stringify(summary, null, 2)}

Visual context: ${visualNote}

Write the thread per the SYSTEM section, in my voice. Lean toward HIGH-PERFORMING patterns; avoid LOW-PERFORMING ones.`;
};

export const writeThread = async (
  summary: DaySummary,
  plan: VisualPlan,
  app: AppConfig,
  corpus: VoiceCorpus,
  llm: LlmProvider,
): Promise<Thread> => {
  return llm.call({
    system: buildSystemPrompt(app),
    fewShot: buildFewShot(app, corpus),
    user: buildUserPrompt(summary, plan),
    schema: ThreadSchema,
    label: "write-thread",
    maxOutputTokens: 2048,
  });
};
