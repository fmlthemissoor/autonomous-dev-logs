import type { ChartSpec } from "../stages/plan-visual.js";

/**
 * Renders a chart to PNG via the public QuickChart.io API.
 *
 * QuickChart accepts a Chart.js v3-compatible config and returns a PNG.
 * No native deps, no canvas install. For higher volume / privacy, swap
 * this for a self-hosted QuickChart container or `chartjs-node-canvas`.
 */
export const renderChart = async (spec: ChartSpec, titlePrefix: string): Promise<Buffer> => {
  const colors = ["#9c48e2", "#48b8e2", "#e2a248", "#48e286", "#e24871", "#a3a3a3"];
  const datasets = spec.datasets.map((d, i) => ({
    label: d.label,
    data: d.data,
    backgroundColor: colors[i % colors.length],
    borderColor: colors[i % colors.length],
    borderWidth: 2,
    fill: spec.type === "line" ? false : true,
  }));

  const chartType = spec.type === "horizontalBar" ? "bar" : spec.type;
  const indexAxis = spec.type === "horizontalBar" ? "y" : undefined;

  const config = {
    type: chartType,
    data: {
      labels: spec.labels,
      datasets,
    },
    options: {
      indexAxis,
      plugins: {
        title: {
          display: true,
          text: `${titlePrefix}: ${spec.title}`,
          font: { size: 18, weight: "bold" },
          color: "#1a1a1a",
        },
        legend: {
          display: datasets.length > 1,
          position: "bottom",
        },
      },
      scales:
        chartType === "pie" || chartType === "doughnut"
          ? undefined
          : {
              x: { ticks: { color: "#1a1a1a" } },
              y: { ticks: { color: "#1a1a1a" } },
            },
    },
  };

  const params = new URLSearchParams({
    c: JSON.stringify(config),
    width: "1200",
    height: "675",
    backgroundColor: "white",
    devicePixelRatio: "2",
  });

  const response = await fetch(`https://quickchart.io/chart?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`QuickChart returned ${response.status}: ${await response.text()}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
