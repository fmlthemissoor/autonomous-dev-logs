import { writeFileSync } from "node:fs";
import { renderChart } from "../src/renderers/chart.js";
import type { ChartSpec } from "../src/stages/plan-visual.js";

const samples: Array<{ name: string; spec: ChartSpec }> = [
  {
    name: "sample-bar-3cat",
    spec: {
      type: "bar",
      title: "Per-claim cost — feature comparison",
      subtitle: "Extended thinking adds $0.08-0.14 without accuracy gain",
      labels: ["Sonnet", "+ Extended Thinking", "Haiku Routing"],
      datasets: [{ label: "Cost ($)", data: [0.2, 0.31, 0.07] }],
    },
  },
  {
    name: "sample-bar-7cat",
    spec: {
      type: "bar",
      title: "Tokens per session by day",
      subtitle: "Last 7 days",
      labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      datasets: [{ label: "Tokens (k)", data: [42, 58, 71, 64, 89, 23, 31] }],
    },
  },
  {
    name: "sample-bar-multiseries",
    spec: {
      type: "bar",
      title: "Cache hit rate vs cost — by model",
      labels: ["Opus", "Sonnet", "Haiku"],
      datasets: [
        { label: "Cache hit %", data: [78, 84, 71] },
        { label: "Cost index", data: [100, 32, 8] },
      ],
    },
  },
  {
    name: "sample-hbar",
    spec: {
      type: "horizontalBar",
      title: "Time spent — by stage",
      subtitle: "Pipeline run, seconds",
      labels: ["transcripts", "summarize", "plan-visual", "write-thread", "render"],
      datasets: [{ label: "Seconds", data: [3.2, 18.4, 9.1, 22.7, 6.5] }],
    },
  },
];

const main = async () => {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  for (const { name, spec } of samples) {
    const buf = await renderChart(spec, "");
    const path = `out/${ts}-${name}.png`;
    writeFileSync(path, buf);
    console.log(`wrote ${path}`);
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
