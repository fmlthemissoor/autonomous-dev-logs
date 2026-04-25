import type { CodeSnippetSpec } from "../stages/plan-visual.js";

/**
 * Renders a syntax-highlighted code snippet to PNG via the carbonara API
 * (an open-source Carbon clone). No auth, no native deps.
 *
 * For air-gapped or branded output, swap this for a Puppeteer + Shiki
 * implementation later — same buffer-returning interface.
 */
export const renderCodeSnippet = async (spec: CodeSnippetSpec): Promise<Buffer> => {
  const body = {
    code: spec.code,
    language: spec.language,
    theme: "one-dark",
    backgroundColor: "rgba(74, 144, 226, 0.0)",
    backgroundImage: null,
    paddingHorizontal: "32px",
    paddingVertical: "32px",
    dropShadow: true,
    windowControls: true,
    widthAdjustment: true,
    lineNumbers: false,
    fontSize: "16px",
    fontFamily: "Hack",
    exportSize: "2x",
    watermark: false,
  };

  const response = await fetch("https://carbonara.solopov.dev/api/cook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`carbonara returned ${response.status}: ${await response.text()}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
