# Autonomous Dev Logs

Turn your daily Claude Code sessions into a tweet-ready dev-log thread, delivered to Telegram for manual posting.

## What it does

1. Reads your Claude Code transcripts from `~/.claude/projects/` for the last N hours.
2. Condenses them (drops verbose tool payloads, keeps prompts / assistant text / tool names / git branches).
3. Asks Claude to summarize the day's work as structured topics.
4. Asks Claude to plan a visual: `none`, `chart`, `code_snippet`, or `illustration` — whichever fits the topic.
5. (Optional) Pulls your recent tweets + tweets from accounts whose voice you admire via SocialData, buckets yours by engagement, and feeds them as labeled few-shot examples.
6. Asks Claude to write an X thread in **your** voice, leaning on high-performing patterns and avoiding low-performing ones.
7. Renders the visual to PNG locally.
8. Sends the thread + image to your Telegram chat. You read it, tweak if needed, post manually.

It does **not** auto-post to X. The point is a human-in-the-loop draft, not autonomous publishing.

## Why this design

- **Few-shot beats fine-tuning.** Pasting 10-20 of your real tweets into the prompt nails your voice without paying for a fine-tune.
- **Voice learning beats hand-curation.** Hand-picking which tweets represent your voice is a chore, and you can't tell which ones actually *land* without checking metrics. Voice learning fetches your tweets via SocialData, scores them by engagement, and surfaces the best AND the worst as labeled examples — the writer learns from contrast.
- **Self vs. inspiration accounts.** Your handle gets bucketed by metrics (your account, your followers, your data). Inspiration accounts (e.g. writers whose style you admire) are pulled too, but only as voice examples — engagement isn't comparable across accounts.
- **The planner picks the visual.** Some days a chart of "tool calls per project" is the move; some days a syntax-highlighted code snippet is better; some days plain text wins. The model decides per-thread.
- **Two LLM modes.** Use your Claude Code Max subscription via the `claude` CLI (no extra cost, shares your 5-hour rate-limit window) or hit the Anthropic API directly (pay per token, but with prompt caching on the few-shot examples).
- **No auto-post.** You always review before publishing.

## Requirements

- Node 20+
- Either Claude Code installed (`claude` on `$PATH`) **or** an Anthropic API key
- A Telegram bot token + your chat id
- (Optional) An OpenAI API key if you want to enable the `illustration` format
- (Optional) A SocialData.tools API key if you want voice learning

## Install

```bash
git clone https://github.com/fmlthemissoor/autonomous-dev-logs.git
cd autonomous-dev-logs
npm install
cp .env.example .env
cp config.example.yaml config.yaml
```

Then edit `.env` and `config.yaml` (see comments inside both files).

## Configure your tweet voice

Two options. Pick one (or both — they layer):

**Option A — Manual (zero setup, less powerful).** Open `config.yaml` and replace `tweet_examples` with 10-20 of your own real tweets. The writer uses them as few-shot examples. Good enough as a starting point.

**Option B — Voice learning (recommended).** Set `voice_learning.enabled: true` in `config.yaml`, fill in `your_handle` (your X handle), and optionally list `voice_accounts` (handles whose style you admire — e.g. writers you wish you wrote like). Drop a `SOCIALDATA_API_KEY` in `.env` (sign up at https://socialdata.tools — pay-as-you-go, fractions of a cent per call).

The system then:

- Pulls your recent tweets and scores them by engagement (likes, RTs, replies, views), normalized so a small account isn't penalized.
- Surfaces your top performers as `HIGH-PERFORMING` examples and your bottom ones as `LOW-PERFORMING` (anti-pattern) examples for the writer.
- Pulls recent tweets from each `voice_account` as unlabeled style examples.
- Caches the corpus to `.cache/voice.json` and refreshes once a week (configurable). API spend is negligible.
- Falls back to your manual `tweet_examples` if your account is too new to bucket cleanly.

To inspect what SocialData returns for a handle (helpful when tuning):

```bash
npm run inspect -- @your_handle 50
```

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

A sample `launchd` plist is in `scripts/launchd.plist.example` — runs once a day at 18:00. Edit the paths, copy to `~/Library/LaunchAgents/com.autonomous-dev-logs.plist`, then:

```bash
launchctl load ~/Library/LaunchAgents/com.autonomous-dev-logs.plist
```

On Linux, drop a line in `crontab -e` like:

```
0 18 * * * cd /path/to/autonomous-dev-logs && /usr/local/bin/npm run send >> ~/autonomous-dev-logs.log 2>&1
```

## Architecture

```
~/.claude/projects/*/*.jsonl   →   transcripts.ts    (read + filter + condense)
                                          ↓
                                   summarize.ts       (LLM: day → topics + stats)
                                          ↓
                                  plan-visual.ts      (LLM: topics → visual spec)
                                          ↓
SocialData (your handle + voice → learn-voice.ts     (fetch, filter, score, bucket — cached weekly)
 accounts, optional)                      ↓
                                  write-thread.ts    (LLM: topics + labeled corpus → thread)
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
- The `.cache/` directory (where the voice corpus is cached) is `.gitignored`. Your fetched tweets stay on your machine.
- Voice learning only reads **public** tweet metadata via SocialData. No OAuth, no auth on your account, no posting permissions.

## License

MIT
