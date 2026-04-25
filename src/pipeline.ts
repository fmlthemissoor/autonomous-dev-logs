import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, EnvConfig } from "./config.js";
import { buildLlmProvider } from "./llm/factory.js";
import { renderVisual } from "./renderers/index.js";
import { planVisual } from "./stages/plan-visual.js";
import { summarizeDay } from "./stages/summarize.js";
import { writeThread } from "./stages/write-thread.js";
import { deliverToTelegram } from "./telegram.js";
import { buildDayDigest } from "./transcripts.js";

export interface PipelineResult {
  outDir: string;
  threadPath: string;
  pngPath: string | null;
  tweetCount: number;
  visualFormat: string;
}

export const runPipeline = async (
  app: AppConfig,
  env: EnvConfig,
  options: { send: boolean },
): Promise<PipelineResult> => {
  const outDir = join(process.cwd(), "out");
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const llm = buildLlmProvider(env);
  console.log(`[pipeline] llm provider: ${llm.name}`);

  console.log("[pipeline] reading transcripts…");
  const digest = buildDayDigest(app, env);
  console.log(
    `[pipeline] window=${digest.windowStartIso}→${digest.windowEndIso} ` +
      `turns=${digest.turns.length} sessions=${digest.stats.sessionCount} ` +
      `projects=${digest.stats.projectCount}`,
  );

  if (digest.turns.length === 0) {
    throw new Error(
      "No Claude Code transcripts found in the lookback window. " +
        "Either you didn't use Claude Code today, or CLAUDE_PROJECTS_DIR is wrong.",
    );
  }

  console.log("[pipeline] summarizing day…");
  const summary = await summarizeDay(digest, llm);
  writeFileSync(join(outDir, `${stamp}-summary.json`), JSON.stringify(summary, null, 2));
  console.log(`[pipeline] summary: ${summary.headline}`);

  console.log("[pipeline] planning visual…");
  const plan = await planVisual(summary, app, llm);
  writeFileSync(join(outDir, `${stamp}-visual-plan.json`), JSON.stringify(plan, null, 2));
  console.log(`[pipeline] visual format: ${plan.format} — ${plan.rationale}`);

  console.log("[pipeline] writing thread…");
  const thread = await writeThread(summary, plan, app, llm);
  const threadPath = join(outDir, `${stamp}-thread.txt`);
  writeFileSync(
    threadPath,
    thread.tweets.map((t, i) => `--- tweet ${i + 1}/${thread.tweets.length} ---\n${t}`).join("\n\n"),
  );
  console.log(`[pipeline] thread: ${thread.tweets.length} tweets`);

  console.log("[pipeline] rendering visual…");
  const visual = await renderVisual(plan, app, env, outDir);
  if (visual.pngPath) {
    console.log(`[pipeline] visual: ${visual.pngPath}`);
  } else {
    console.log("[pipeline] visual: none");
  }

  if (options.send) {
    console.log("[pipeline] delivering to Telegram…");
    await deliverToTelegram(env, thread, visual.pngPath);
    console.log("[pipeline] delivered.");
  } else {
    console.log("[pipeline] dry run — skipped Telegram. Files in ./out/.");
  }

  return {
    outDir,
    threadPath,
    pngPath: visual.pngPath,
    tweetCount: thread.tweets.length,
    visualFormat: visual.format,
  };
};
