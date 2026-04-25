import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { LlmProvider } from "../llm/types.js";
import type { DaySummary } from "./summarize.js";

const ChartSpecSchema = z.object({
  type: z.enum(["bar", "line", "pie", "doughnut", "horizontalBar"]),
  title: z.string().min(1),
  labels: z.array(z.string().min(1)).min(1),
  datasets: z
    .array(
      z.object({
        label: z.string(),
        data: z.array(z.number()),
      }),
    )
    .min(1),
});

const CodeSnippetSpecSchema = z.object({
  language: z.string().min(1),
  code: z.string().min(1),
  caption: z.string().optional(),
});

const IllustrationSpecSchema = z.object({
  prompt: z.string().min(1),
  style: z.string().optional(),
});

export const VisualPlanSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("none"),
    rationale: z.string().min(1),
  }),
  z.object({
    format: z.literal("chart"),
    rationale: z.string().min(1),
    chart: ChartSpecSchema,
  }),
  z.object({
    format: z.literal("code_snippet"),
    rationale: z.string().min(1),
    code_snippet: CodeSnippetSpecSchema,
  }),
  z.object({
    format: z.literal("illustration"),
    rationale: z.string().min(1),
    illustration: IllustrationSpecSchema,
  }),
]);

export type VisualPlan = z.infer<typeof VisualPlanSchema>;
export type ChartSpec = z.infer<typeof ChartSpecSchema>;
export type CodeSnippetSpec = z.infer<typeof CodeSnippetSpecSchema>;
export type IllustrationSpec = z.infer<typeof IllustrationSpecSchema>;

const buildSystemPrompt = (allowed: string[]): string => `You decide what visual (if any) should accompany an X/Twitter dev-log thread.

You receive a structured summary of a developer's day. Pick the format that best amplifies the thread.

Allowed formats: ${allowed.join(", ")}.

Format guide:
- "none" — when the thread stands on its own and a visual would feel forced. Default to this if you're unsure.
- "chart" — when there are clear numeric facts (lines changed, latency before/after, count of bugs by kind). Provide a Chart.js-compatible spec. Bars and horizontal bars usually beat pies.
- "code_snippet" — when the most interesting topic is a small, beautiful piece of code or a diff (≤ 25 lines). Provide language and the literal code. Pick code that tells a story without context.
- "illustration" — only if the day is conceptual/story-driven (e.g. "ripped out an entire subsystem"). Provide a short, vivid image prompt.

Output strictly this JSON shape (one of):

{ "format": "none", "rationale": "string" }

{
  "format": "chart",
  "rationale": "string",
  "chart": {
    "type": "bar" | "line" | "pie" | "doughnut" | "horizontalBar",
    "title": "string",
    "labels": ["string", ...],
    "datasets": [{ "label": "string", "data": [number, ...] }, ...]
  }
}

{
  "format": "code_snippet",
  "rationale": "string",
  "code_snippet": {
    "language": "string (e.g. typescript, python, sql)",
    "code": "string — the actual code, with newlines",
    "caption": "optional one-line caption"
  }
}

{
  "format": "illustration",
  "rationale": "string",
  "illustration": {
    "prompt": "string — image prompt",
    "style": "optional short style hint"
  }
}

Be honest: if the day's topics don't have strong numeric or visual content, pick "none". A bad chart is worse than no chart.`;

export const planVisual = async (
  summary: DaySummary,
  app: AppConfig,
  llm: LlmProvider,
): Promise<VisualPlan> => {
  if (!app.visual.enabled) {
    return { format: "none", rationale: "Visuals disabled in config." };
  }

  const user = `Day summary:

${JSON.stringify(summary, null, 2)}

Pick a visual per the SYSTEM section. Stick to the allowed formats.`;

  return llm.call({
    system: buildSystemPrompt(app.visual.allowed_formats),
    fewShot: [],
    user,
    schema: VisualPlanSchema,
    label: "plan-visual",
    maxOutputTokens: 2048,
  });
};
