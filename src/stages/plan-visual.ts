import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { LlmProvider } from "../llm/types.js";
import type { DaySummary } from "./summarize.js";

const ChartSpecSchema = z.object({
  type: z.enum(["bar", "line", "pie", "doughnut", "horizontalBar"]),
  title: z.string().min(1),
  /**
   * Optional one-line subtitle rendered in muted gray under the title.
   * Use it for context the title can't carry: sample size, model used,
   * date range, key takeaway. Editorial-style.
   */
  subtitle: z.string().optional(),
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

const buildSystemPrompt = (allowed: string[]): string => `You decide what visual (if any) should accompany an X/Twitter dev-log post.

You receive ONE story from a developer's day (not a summary of the whole day). Pick the visual format that best amplifies that single story.

Allowed formats: ${allowed.join(", ")}.

Format guide:
- "none" — when the post stands on its own and a visual would feel forced. Default to this if you're unsure. Single-tweet posts often don't need a visual.
- "chart" — when the story has clear numeric facts (lines changed, latency before/after, step counts). Provide a Chart.js-compatible spec. Bars and horizontal bars usually beat pies. Always prefer "horizontalBar" for ranking ≥3 categories — labels stay legible.

CHART STYLE GUIDE (editorial-minimal — match this):
- Title: short and concrete. Six words, sentence case. "Wasted steps per claim — v0.3 vs v0.4 baseline" not "Performance comparison of agent versions".
- Subtitle: ONE optional line in muted gray. Use it for context: sample size ("n=352 traces"), model ("Sonnet 4.6"), or the headline finding ("avg savings 51.5% with prompt caching"). Skip it if the title already says everything.
- Datasets: 1-3 series max. Charts with 4+ series are noise.
- Labels: short. "Before / After" beats "Before optimization / After optimization".
- Numbers: prefer integers or 1-2 decimals. The renderer puts data labels on bars so you don't need to redundantly include them in dataset labels.
- "code_snippet" — when the story is best told by a small, beautiful piece of code or a diff (≤ 25 lines). Provide language and the literal code. Pick code that tells the story without needing context.
- "illustration" — only if the story is conceptual (e.g. "ripped out an entire subsystem"). Provide a short, vivid image prompt.

Output strictly this JSON shape (one of):

{ "format": "none", "rationale": "string" }

{
  "format": "chart",
  "rationale": "string",
  "chart": {
    "type": "bar" | "line" | "pie" | "doughnut" | "horizontalBar",
    "title": "string — short, concrete, sentence case",
    "subtitle": "string — optional, one line of muted-gray context (n=, model, finding)",
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

Be honest: if the story doesn't have strong numeric or visual content, pick "none". A bad chart is worse than no chart.`;

export const planVisual = async (
  summary: DaySummary,
  app: AppConfig,
  llm: LlmProvider,
): Promise<VisualPlan> => {
  if (!app.visual.enabled) {
    return { format: "none", rationale: "Visuals disabled in config." };
  }

  const user = `Today's story:

${JSON.stringify(summary.story, null, 2)}

Day mood: ${summary.mood}

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
