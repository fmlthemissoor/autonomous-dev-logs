import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { LlmProvider, LlmMessage } from "../llm/types.js";
import type { DaySummary } from "./summarize.js";
import type { VisualPlan } from "./plan-visual.js";

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

Output strictly:
{
  "tweets": ["string", "string", ...]
}`;

const buildFewShot = (app: AppConfig): LlmMessage[] => {
  const examples = app.tweet_examples.slice(0, 20);
  // Pack all examples into one user/assistant exchange so the cache breakpoint
  // sits on a single boundary. The "assistant" turn shows the format we want.
  return [
    {
      role: "user",
      content: `Here are ${examples.length} examples of my real tweets. Match this voice and style when writing future threads. Reply with the JSON: {"acknowledged": true}.

${examples.map((t, i) => `--- example ${i + 1} ---\n${t}`).join("\n\n")}`,
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

Write the thread per the SYSTEM section, in my voice (matching the examples).`;
};

export const writeThread = async (
  summary: DaySummary,
  plan: VisualPlan,
  app: AppConfig,
  llm: LlmProvider,
): Promise<Thread> => {
  return llm.call({
    system: buildSystemPrompt(app),
    fewShot: buildFewShot(app),
    user: buildUserPrompt(summary, plan),
    schema: ThreadSchema,
    label: "write-thread",
    maxOutputTokens: 2048,
  });
};
