# Automated X Dev Logs

Turn your daily Claude Code sessions into a tweet-ready dev-log thread, delivered to Telegram for manual posting.

## What it does

1. Reads your Claude Code transcripts from `~/.claude/projects/` for the last N hours.
2. Condenses them (drops verbose tool payloads, keeps prompts / assistant text / tool names / git branches).
3. Asks Claude to summarize the day's work as structured topics.
4. Asks Claude to plan a visual: `none`, `chart`, `code_snippet`, or `illustration` — whichever fits the topic.
5. Asks Claude to write an X thread in **your** voice, using few-shot examples of your real tweets.
6. Renders the visual to PNG locally.
7. Sends the thread + image to your Telegram chat. You read it, tweak if needed, post manually.

It does **not** auto-post to X. The point is a human-in-the-loop draft, not autonomous publishing.

## Why this design

- **Few-shot beats fine-tuning.** Pasting 10-20 of your real tweets into the prompt nails your voice without paying for a fine-tune.
- **The planner picks the visual.** Some days a chart of "tool calls per project" is the move; some days a syntax-highlighted code snippet is better; some days plain text wins. The model decides per-thread.
- **Two LLM modes.** Use your Claude Code Max subscription via the `claude` CLI (no extra cost, shares your 5-hour rate-limit window) or hit the Anthropic API directly (pay per token, but with prompt caching on the few-shot examples).
- **No auto-post.** You always review before publishing.

## Requirements

- Node 20+
- Either Claude Code installed (`claude` on `$PATH`) **or** an Anthropic API key
- A Telegram bot token + your chat id
- (Optional) An OpenAI API key if you want to enable the `illustration` format

## Install

```bash
git clone https://github.com/fmlthemissoor/automated-x-dev-logs.git
cd automated-x-dev-logs
npm install
cp .env.example .env
cp config.example.yaml config.yaml
```

Then edit `.env` and `config.yaml` (see comments inside both files).

## Configure your tweet voice

Open `config.yaml` and replace the `tweet_examples` with **your own real tweets**. The more representative the voice, the better the generated thread will sound. 10-20 examples is the sweet spot.

## Configure Telegram

1. Open Telegram, talk to [@BotFather](https://t.me/BotFather), run `/newbot`. Save the token.
2. Send any message to your new bot.
3. Visit `https://api.telegram.org/bot<token>/getUpdates` and look for `"chat":{"id":<NUMBER>}`. That's your `TELEGRAM_CHAT_ID`.

## Use

Dry run (writes thread + image to `./out/`, no Telegram):

```bash
npm run generate
```

Full run (renders + delivers to Telegram):

```bash
npm run send
```

## Schedule it (macOS)

A sample `launchd` plist is in `scripts/launchd.plist.example` — runs once a day at 18:00. Edit the paths, copy to `~/Library/LaunchAgents/com.automated-x-dev-logs.plist`, then:

```bash
launchctl load ~/Library/LaunchAgents/com.automated-x-dev-logs.plist
```

On Linux, drop a line in `crontab -e` like:

```
0 18 * * * cd /path/to/automated-x-dev-logs && /usr/local/bin/npm run send >> ~/automated-x-dev-logs.log 2>&1
```

## Architecture

```
~/.claude/projects/*/*.jsonl   →   transcripts.ts   (read + filter + condense)
                                          ↓
                                   summarize.ts      (LLM: day → topics + stats)
                                          ↓
                                  plan-visual.ts     (LLM: topics → visual spec)
                                          ↓
                                  write-thread.ts    (LLM: topics + tweet examples → thread)
                                          ↓
                                renderers/*.ts       (chart | code_snippet | illustration | none)
                                          ↓
                                   telegram.ts       (sendPhoto + sendMessage)
```

The LLM provider lives behind a small interface in `src/llm/types.ts` with two implementations (`subscription.ts`, `api.ts`). Switch via `LLM_PROVIDER` in `.env`.

## Privacy

- All transcript reading is local. Nothing leaves your machine until the LLM call.
- The `out/` directory and `config.yaml` are `.gitignored`. Generated threads, images, and your tweet examples never get committed.
- The condenser drops tool result payloads larger than `transcripts.max_tool_result_chars` (default 800) before sending anything to the LLM. So source code dumps and command output don't get shipped wholesale.
- Use `transcripts.exclude_cwd_substrings` to keep specific projects out of the summary entirely.

## License

MIT
