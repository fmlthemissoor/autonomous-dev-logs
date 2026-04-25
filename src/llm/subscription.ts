import { spawn } from "node:child_process";
import type { LlmCallOptions, LlmProvider } from "./types.js";
import { extractJson } from "./json-extract.js";

/**
 * Calls Claude Code in headless mode (`claude -p ...`) and reads the response
 * from stdout. Counts against your Claude Code Max subscription instead of
 * Anthropic API credits.
 *
 * Note: Claude Code's headless mode does not expose the same prompt-caching
 * controls as the API. The whole prompt is sent each call.
 */
export class ClaudeSubscriptionProvider implements LlmProvider {
  readonly name = "claude-subscription";

  constructor(private readonly cliPath?: string) {}

  async call<T>(opts: LlmCallOptions<T>): Promise<T> {
    const conversation: string[] = [];
    conversation.push(`SYSTEM:\n${opts.system}`);
    for (const m of opts.fewShot) {
      conversation.push(`${m.role.toUpperCase()}:\n${m.content}`);
    }
    conversation.push(`USER:\n${opts.user}`);
    conversation.push(
      "\nRespond with ONLY the JSON described in the SYSTEM section. No prose, no code fences.",
    );
    const prompt = conversation.join("\n\n");

    const bin = this.cliPath || "claude";
    const args = ["-p", "--output-format", "text"];

    const stdout = await new Promise<string>((resolve, reject) => {
      const child = spawn(bin, args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let out = "";
      let err = "";
      child.stdout.on("data", (chunk) => {
        out += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        err += chunk.toString("utf8");
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`[${opts.label}] claude CLI exited ${code}: ${err}`));
      });
      child.stdin.write(prompt);
      child.stdin.end();
    });

    const parsed = extractJson(stdout);
    return opts.schema.parse(parsed);
  }
}
