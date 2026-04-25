#!/usr/bin/env tsx
/**
 * Quick utility to inspect what SocialData returns for a handle.
 * Usage: npm run inspect -- @some_handle [maxTweets]
 *
 * Reads SOCIALDATA_API_KEY from .env. Doesn't write anything to disk.
 */
import { config as loadDotenv } from "dotenv";
import { fetchHandleTweets } from "../src/socialdata.js";

loadDotenv();

const main = async (): Promise<void> => {
  const handle = process.argv[2];
  const maxTweets = Number(process.argv[3] || 20);
  if (!handle) {
    console.error("Usage: npm run inspect -- @handle [maxTweets]");
    process.exit(1);
  }
  const apiKey = process.env.SOCIALDATA_API_KEY;
  if (!apiKey) {
    console.error("SOCIALDATA_API_KEY missing from .env");
    process.exit(1);
  }

  const { profile, tweets } = await fetchHandleTweets(handle, apiKey, {
    maxTweets,
    maxPages: Math.ceil(maxTweets / 20),
  });

  console.log(JSON.stringify({ profile, tweetCount: tweets.length }, null, 2));
  console.log("\n--- engagement breakdown ---");
  const summary = tweets.map((t) => ({
    type: t.type,
    is_reply: t.in_reply_to_status_id_str !== null,
    likes: t.favorite_count,
    rts: t.retweet_count,
    replies: t.reply_count,
    views: t.views_count,
    text: t.full_text.slice(0, 80),
  }));
  console.log(JSON.stringify(summary, null, 2));
};

main().catch((err) => {
  console.error("[inspect] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
