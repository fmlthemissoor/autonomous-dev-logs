#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { refreshVoiceCorpus, voiceLibraryPath } from "../src/stages/learn-voice.js";

const main = async (): Promise<void> => {
  const { app, env } = loadConfig();
  console.log(
    `[refresh-voice] fetching from ${app.voice_learning.voice_accounts.length} account(s): ` +
      app.voice_learning.voice_accounts.join(", "),
  );
  const corpus = await refreshVoiceCorpus(app, env);
  for (const note of corpus.notes) console.log(`[refresh-voice]   ${note}`);
  console.log(
    `[refresh-voice] wrote ${corpus.voiceAccounts.length} tweet(s) to ${voiceLibraryPath()}`,
  );
};

main().catch((err) => {
  console.error("[refresh-voice] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
