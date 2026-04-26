#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { personalFeedPath, refreshPersonalFeed } from "../src/stages/personal-feed.js";

const main = async (): Promise<void> => {
  const { app, env } = loadConfig();
  console.log(
    `[refresh-personal-feed] fetching ${app.personal_feed.max_tweets} tweets from ${app.handle}…`,
  );
  const feed = await refreshPersonalFeed(app, env);
  for (const note of feed.notes) console.log(`[refresh-personal-feed]   ${note}`);
  console.log(
    `[refresh-personal-feed] wrote ${feed.tweets.length} tweet(s) to ${personalFeedPath()}`,
  );
};

main().catch((err) => {
  console.error("[refresh-personal-feed] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
