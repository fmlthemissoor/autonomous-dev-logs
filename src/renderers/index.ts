import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, EnvConfig } from "../config.js";
import type { VisualPlan } from "../stages/plan-visual.js";
import { renderChart } from "./chart.js";
import { renderCodeSnippet } from "./code.js";
import { renderIllustration } from "./illustration.js";

export interface RenderedVisual {
  format: VisualPlan["format"];
  pngPath: string | null;
}

export const renderVisual = async (
  plan: VisualPlan,
  app: AppConfig,
  env: EnvConfig,
  outDir: string,
): Promise<RenderedVisual> => {
  if (plan.format === "none") {
    return { format: "none", pngPath: null };
  }

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  if (plan.format === "chart") {
    const buffer = await renderChart(plan.chart, app.visual.chart_title_prefix);
    const path = join(outDir, `${stamp}-chart.png`);
    writeFileSync(path, buffer);
    return { format: "chart", pngPath: path };
  }

  if (plan.format === "code_snippet") {
    const buffer = await renderCodeSnippet(plan.code_snippet);
    const path = join(outDir, `${stamp}-code.png`);
    writeFileSync(path, buffer);
    return { format: "code_snippet", pngPath: path };
  }

  if (plan.format === "illustration") {
    if (!env.openaiApiKey) {
      // The planner should have been told this format isn't allowed, but if
      // it picked illustration anyway and we have no key, fall back to none.
      return { format: "none", pngPath: null };
    }
    const buffer = await renderIllustration(plan.illustration, env.openaiApiKey);
    const path = join(outDir, `${stamp}-illustration.png`);
    writeFileSync(path, buffer);
    return { format: "illustration", pngPath: path };
  }

  return { format: "none", pngPath: null };
};
