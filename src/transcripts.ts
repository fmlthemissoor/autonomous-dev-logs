import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig, EnvConfig } from "./config.js";

interface RawEvent {
  type?: string;
  message?: {
    role?: string;
    content?: unknown;
    model?: string;
  };
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  sessionId?: string;
}

export interface CondensedTurn {
  role: "user" | "assistant";
  text: string;
  toolCalls: Array<{ name: string; inputPreview: string }>;
  toolResults: Array<{ name: string; preview: string; truncated: boolean }>;
  timestamp: string;
  cwd: string;
  gitBranch?: string;
  sessionId: string;
  model?: string;
}

export interface DayDigest {
  windowStartIso: string;
  windowEndIso: string;
  turns: CondensedTurn[];
  stats: {
    sessionCount: number;
    projectCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    toolCallsByName: Record<string, number>;
    branchesByProject: Record<string, string[]>;
    projectMessageCounts: Record<string, number>;
  };
}

const isWithinWindow = (iso: string | undefined, startMs: number, endMs: number): boolean => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= startMs && t <= endMs;
};

const cwdMatches = (cwd: string, includes: string[], excludes: string[]): boolean => {
  if (excludes.some((s) => cwd.includes(s))) return false;
  if (includes.length === 0) return true;
  return includes.some((s) => cwd.includes(s));
};

const truncate = (s: string, max: number): { value: string; truncated: boolean } => {
  if (s.length <= max) return { value: s, truncated: false };
  return { value: s.slice(0, max) + "…", truncated: true };
};

const stringifyContent = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .filter((s) => s.length > 0)
      .join("\n");
  }
  return "";
};

const extractToolCalls = (content: unknown): Array<{ name: string; inputPreview: string }> => {
  if (!Array.isArray(content)) return [];
  const calls: Array<{ name: string; inputPreview: string }> = [];
  for (const part of content) {
    if (part && typeof part === "object" && (part as { type?: string }).type === "tool_use") {
      const name = String((part as { name?: string }).name || "unknown");
      const input = (part as { input?: unknown }).input;
      const preview = truncate(JSON.stringify(input ?? {}), 200).value;
      calls.push({ name, inputPreview: preview });
    }
  }
  return calls;
};

const extractToolResults = (
  content: unknown,
  maxChars: number,
): Array<{ name: string; preview: string; truncated: boolean }> => {
  if (!Array.isArray(content)) return [];
  const results: Array<{ name: string; preview: string; truncated: boolean }> = [];
  for (const part of content) {
    if (part && typeof part === "object" && (part as { type?: string }).type === "tool_result") {
      const raw = stringifyContent((part as { content?: unknown }).content);
      const { value, truncated } = truncate(raw, maxChars);
      results.push({ name: "tool_result", preview: value, truncated });
    }
  }
  return results;
};

const findJsonlFiles = (dir: string): string[] => {
  const files: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      files.push(...findJsonlFiles(full));
    } else if (info.isFile() && entry.endsWith(".jsonl")) {
      files.push(full);
    }
  }
  return files;
};

export const buildDayDigest = (app: AppConfig, env: EnvConfig): DayDigest => {
  const endMs = Date.now();
  const startMs = endMs - env.lookbackHours * 3600 * 1000;
  const turns: CondensedTurn[] = [];

  const allFiles = findJsonlFiles(env.claudeProjectsDir);
  const recentFiles = allFiles.filter((f) => {
    try {
      return statSync(f).mtimeMs >= startMs;
    } catch {
      return false;
    }
  });

  const sessionsSeen = new Set<string>();
  const projectsSeen = new Set<string>();
  const branchesByProject: Record<string, Set<string>> = {};
  const projectMessageCounts: Record<string, number> = {};
  const toolCallsByName: Record<string, number> = {};
  let userMessageCount = 0;
  let assistantMessageCount = 0;

  for (const file of recentFiles) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      let event: RawEvent;
      try {
        event = JSON.parse(line) as RawEvent;
      } catch {
        continue;
      }
      if (!isWithinWindow(event.timestamp, startMs, endMs)) continue;
      const cwd = event.cwd || "unknown";
      if (!cwdMatches(cwd, app.transcripts.include_cwd_substrings, app.transcripts.exclude_cwd_substrings)) {
        continue;
      }
      const role = event.message?.role;
      if (role !== "user" && role !== "assistant") continue;

      const text = stringifyContent(event.message?.content);
      const toolCalls = extractToolCalls(event.message?.content);
      const toolResults = extractToolResults(
        event.message?.content,
        app.transcripts.max_tool_result_chars,
      );

      // Skip turns with no useful signal (empty text, no tool calls, no tool results).
      if (!text && toolCalls.length === 0 && toolResults.length === 0) continue;

      // Content-level exclusion: drop turns whose text or tool inputs mention
      // any forbidden substring. Catches sessions with the right cwd but
      // contaminated content (e.g. the model was asked to look at a file
      // from another project).
      const excludeText = app.transcripts.exclude_text_substrings;
      if (excludeText.length > 0) {
        const haystack =
          text +
          " " +
          toolCalls.map((c) => c.inputPreview).join(" ") +
          " " +
          toolResults.map((r) => r.preview).join(" ");
        if (excludeText.some((s) => haystack.includes(s))) continue;
      }

      const sessionId = event.sessionId || "unknown";
      sessionsSeen.add(sessionId);
      projectsSeen.add(cwd);
      projectMessageCounts[cwd] = (projectMessageCounts[cwd] || 0) + 1;
      if (event.gitBranch) {
        const set = branchesByProject[cwd] || new Set<string>();
        set.add(event.gitBranch);
        branchesByProject[cwd] = set;
      }
      if (role === "user") userMessageCount++;
      else assistantMessageCount++;
      for (const call of toolCalls) {
        toolCallsByName[call.name] = (toolCallsByName[call.name] || 0) + 1;
      }

      turns.push({
        role,
        text: truncate(text, 1500).value,
        toolCalls,
        toolResults,
        timestamp: event.timestamp || new Date().toISOString(),
        cwd,
        gitBranch: event.gitBranch,
        sessionId,
        model: event.message?.model,
      });
    }
  }

  turns.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  const branchesAsArrays: Record<string, string[]> = {};
  for (const [project, set] of Object.entries(branchesByProject)) {
    branchesAsArrays[project] = [...set];
  }

  return {
    windowStartIso: new Date(startMs).toISOString(),
    windowEndIso: new Date(endMs).toISOString(),
    turns,
    stats: {
      sessionCount: sessionsSeen.size,
      projectCount: projectsSeen.size,
      userMessageCount,
      assistantMessageCount,
      toolCallsByName,
      branchesByProject: branchesAsArrays,
      projectMessageCounts,
    },
  };
};

/**
 * Render the digest as a single string for inclusion in an LLM prompt.
 * Token-conscious: drops timestamps, keeps only project basenames, caps total size.
 */
export const digestToPromptText = (digest: DayDigest, maxChars = 60_000): string => {
  const lines: string[] = [];
  lines.push(`Window: ${digest.windowStartIso} → ${digest.windowEndIso}`);
  lines.push(
    `Stats: ${digest.stats.sessionCount} sessions, ${digest.stats.projectCount} projects, ` +
      `${digest.stats.userMessageCount} user msgs, ${digest.stats.assistantMessageCount} assistant msgs`,
  );
  lines.push("Tool calls by name: " + JSON.stringify(digest.stats.toolCallsByName));
  lines.push("Branches by project: " + JSON.stringify(digest.stats.branchesByProject));
  lines.push("");
  lines.push("--- Turns (chronological) ---");
  for (const turn of digest.turns) {
    const project = turn.cwd.split("/").slice(-2).join("/");
    const branch = turn.gitBranch ? ` [${turn.gitBranch}]` : "";
    lines.push(`\n[${turn.role}] ${project}${branch}`);
    if (turn.text) lines.push(turn.text);
    for (const call of turn.toolCalls) {
      lines.push(`  → tool:${call.name} ${call.inputPreview}`);
    }
    for (const result of turn.toolResults) {
      const tag = result.truncated ? "[truncated]" : "";
      if (result.preview) lines.push(`  ← result ${tag} ${result.preview}`);
    }
  }
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;
  // Keep the most recent half of turns; older context is less interesting for "today's thread".
  return joined.slice(joined.length - maxChars) + "\n[earlier turns truncated]";
};
