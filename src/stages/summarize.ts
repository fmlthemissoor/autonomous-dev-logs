import { z } from "zod";
import type { LlmProvider } from "../llm/types.js";
import type { DayDigest } from "../transcripts.js";
import { digestToPromptText } from "../transcripts.js";

export const DaySummarySchema = z.object({
  headline: z.string().min(1),
  topics: z
    .array(
      z.object({
        title: z.string().min(1),
        detail: z.string().min(1),
        // Optional concrete data points the renderer can use (file names,
        // metrics, before/after numbers).
        evidence: z.array(z.string()).default([]),
        kind: z.enum(["feature", "bug", "refactor", "investigation", "discovery", "infra", "other"]),
      }),
    )
    .min(1),
  // Free-form numeric stats the model spotted that might be chartable.
  chartable_stats: z
    .array(
      z.object({
        label: z.string().min(1),
        value: z.number(),
      }),
    )
    .default([]),
  // 1-3 sentence overall vibe for the day. Used by the visual planner.
  mood: z.string().min(1),
});

export type DaySummary = z.infer<typeof DaySummarySchema>;

const SYSTEM = `You summarize a software developer's day from raw Claude Code session transcripts.

Your output is a structured JSON summary. Focus on:
- Concrete things shipped, fixed, or learned (NOT every tool call)
- Bugs encountered and their root cause
- Non-obvious discoveries or design decisions
- Numeric facts the developer might tweet (e.g. "deleted 400 lines", "p99 dropped 30%")

Skip:
- Trivial commands (ls, cd, git status)
- Failed exploratory branches that went nowhere
- Internal tool noise

Output strictly this JSON shape:
{
  "headline": "string — one sentence overall summary of the day",
  "topics": [
    {
      "title": "string — short topic title",
      "detail": "string — 1-3 sentences of substance",
      "evidence": ["string", ...] — concrete file names, metrics, quotes,
      "kind": "feature" | "bug" | "refactor" | "investigation" | "discovery" | "infra" | "other"
    },
    ...
  ],
  "chartable_stats": [
    { "label": "string", "value": number },
    ...
  ],
  "mood": "string — 1-3 sentences"
}

Return between 1 and 5 topics. Pick the most tweetable ones if there are more.`;

export const summarizeDay = async (digest: DayDigest, llm: LlmProvider): Promise<DaySummary> => {
  const transcript = digestToPromptText(digest);
  const user = `Here are the developer's Claude Code transcripts for the window:

${transcript}

Summarize the day per the JSON schema in the SYSTEM section.`;

  return llm.call({
    system: SYSTEM,
    fewShot: [],
    user,
    schema: DaySummarySchema,
    label: "summarize-day",
    maxOutputTokens: 2048,
  });
};
