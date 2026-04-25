import { readFileSync } from "node:fs";
import { basename } from "node:path";
import type { EnvConfig } from "./config.js";
import type { Thread } from "./stages/write-thread.js";

const TELEGRAM_API = "https://api.telegram.org";

const sendMessage = async (env: EnvConfig, text: string): Promise<void> => {
  const response = await fetch(`${TELEGRAM_API}/bot${env.telegramBotToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: env.telegramChatId,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed (${response.status}): ${await response.text()}`);
  }
};

const sendPhoto = async (env: EnvConfig, pngPath: string, caption: string): Promise<void> => {
  const buffer = readFileSync(pngPath);
  // Telegram captions cap at 1024 chars. If the first tweet is longer,
  // send the photo with a short header and the full text as a follow-up.
  const safeCaption = caption.length <= 1024 ? caption : `${caption.slice(0, 1000)}…`;

  const form = new FormData();
  form.append("chat_id", env.telegramChatId || "");
  form.append("caption", safeCaption);
  form.append("photo", new Blob([new Uint8Array(buffer)], { type: "image/png" }), basename(pngPath));

  const response = await fetch(`${TELEGRAM_API}/bot${env.telegramBotToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  if (!response.ok) {
    throw new Error(`Telegram sendPhoto failed (${response.status}): ${await response.text()}`);
  }
};

export const deliverToTelegram = async (
  env: EnvConfig,
  thread: Thread,
  pngPath: string | null,
): Promise<void> => {
  if (!env.telegramBotToken || !env.telegramChatId) {
    throw new Error("Telegram delivery requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env");
  }
  if (thread.tweets.length === 0) return;

  const header = "📝 Today's dev log thread (review and post manually)";
  await sendMessage(env, header);

  // Numbered tweets, one Telegram message per tweet, so it's easy to copy each.
  for (let i = 0; i < thread.tweets.length; i++) {
    const numbered = `${i + 1}/${thread.tweets.length}\n\n${thread.tweets[i]}`;
    await sendMessage(env, numbered);
  }

  if (pngPath) {
    await sendPhoto(env, pngPath, "Visual for the thread");
  }
};
