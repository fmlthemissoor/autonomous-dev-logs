#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { runPipeline } from "./pipeline.js";

const printUsage = (): void => {
  console.log(`Usage: automated-x-dev-logs [--dry-run | --send]

  --dry-run   Generate the thread + visual into ./out/, skip Telegram.
  --send      Generate AND deliver to Telegram (requires TELEGRAM_* env vars).

Without flags, defaults to --dry-run.`);
};

const main = async (): Promise<void> => {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printUsage();
    return;
  }

  const send = args.has("--send");
  const dry = args.has("--dry-run") || !send;

  if (send && dry && args.has("--dry-run")) {
    console.error("Pick one of --dry-run or --send, not both.");
    process.exit(1);
  }

  const { app, env } = loadConfig();
  const result = await runPipeline(app, env, { send });

  console.log(`\nDone.
  thread:  ${result.threadPath}
  visual:  ${result.pngPath ?? "(none)"}
  tweets:  ${result.tweetCount}
  format:  ${result.visualFormat}
  delivered: ${send ? "yes" : "no (dry run)"}`);
};

main().catch((err) => {
  console.error("[cli] fatal:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exit(1);
});
