import type { ChartSpec } from "../stages/plan-visual.js";

/**
 * Renders a chart to PNG via the public QuickChart.io API.
 *
 * Style: editorial-minimal (near-black on white, restrained palette, light
 * gridlines, generous padding, inline data labels via chartjs-plugin-datalabels
 * which QuickChart supports natively).
 */

const PALETTE = {
  ink: "#1a1a1a",
  red: "#e25c63",
  teal: "#4cb5b3",
  amber: "#d49a3a",
  green: "#5fa969",
  purple: "#8c63b3",
  muted: "#9aa0a6",
  grid: "#ececec",
  background: "#ffffff",
} as const;

// Series colors in priority order. First series gets ink (the chart's "main
// character"), subsequent series get muted accents. Single-series charts
// therefore default to a clean monochrome look.
const SERIES_COLORS = [
  PALETTE.ink,
  PALETTE.red,
  PALETTE.teal,
  PALETTE.amber,
  PALETTE.green,
  PALETTE.purple,
];

// Pie / doughnut slices need distinct colors per slice rather than per series.
const CIRCULAR_SLICE_COLORS = [
  PALETTE.ink,
  PALETTE.red,
  PALETTE.teal,
  PALETTE.amber,
  PALETTE.green,
  PALETTE.purple,
  PALETTE.muted,
];

const FONT_FAMILY =
  "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif";

const formatDataLabel = (raw: unknown): string => {
  if (typeof raw !== "number") return String(raw ?? "");
  if (!Number.isFinite(raw)) return "";
  if (Number.isInteger(raw)) return raw.toString();
  // Two decimals for non-integers; trim trailing zeros for cleaner look.
  return Number(raw.toFixed(2)).toString();
};

export const renderChart = async (
  spec: ChartSpec,
  // titlePrefix kept for backwards-compatibility with callers; intentionally
  // unused in the new editorial style — title speaks for itself.
  _titlePrefix: string,
): Promise<Buffer> => {
  const isHorizontalBar = spec.type === "horizontalBar";
  const chartType = isHorizontalBar ? "bar" : spec.type;
  const isCircular = chartType === "pie" || chartType === "doughnut";
  const isLine = chartType === "line";
  const seriesCount = spec.datasets.length;

  const datasets = spec.datasets.map((d, i) => {
    const seriesColor = SERIES_COLORS[i % SERIES_COLORS.length];
    if (isLine) {
      return {
        label: d.label,
        data: d.data,
        borderColor: seriesColor,
        backgroundColor: seriesColor,
        pointBackgroundColor: seriesColor,
        pointBorderColor: seriesColor,
        borderWidth: 2,
        pointRadius: 2.5,
        pointHoverRadius: 3,
        fill: false,
        tension: 0.25,
        // Don't put data labels on line charts — they clutter dense series.
        // Annotations / endpoint labels would be better but require the
        // annotation plugin and case-by-case placement.
        datalabels: { display: false },
      };
    }
    if (isCircular) {
      return {
        label: d.label,
        data: d.data,
        backgroundColor: d.data.map(
          (_, j) => CIRCULAR_SLICE_COLORS[j % CIRCULAR_SLICE_COLORS.length],
        ),
        borderColor: PALETTE.background,
        borderWidth: 2,
      };
    }
    // bar / horizontalBar
    return {
      label: d.label,
      data: d.data,
      backgroundColor: seriesColor,
      borderColor: seriesColor,
      borderWidth: 0,
      borderRadius: 3,
      maxBarThickness: 36,
    };
  });

  const config = {
    type: chartType,
    data: { labels: spec.labels, datasets },
    options: {
      indexAxis: isHorizontalBar ? "y" : "x",
      layout: {
        padding: { top: 20, right: 32, bottom: 20, left: 24 },
      },
      plugins: {
        title: {
          display: true,
          text: spec.title,
          align: "start",
          color: PALETTE.ink,
          font: { family: FONT_FAMILY, size: 22, weight: "500" },
          padding: { top: 8, bottom: spec.subtitle ? 2 : 18 },
        },
        subtitle: {
          display: !!spec.subtitle,
          text: spec.subtitle ?? "",
          align: "start",
          color: PALETTE.muted,
          font: { family: FONT_FAMILY, size: 13, weight: "400" },
          padding: { bottom: 22 },
        },
        legend: {
          // Hide legend when there's only one series (the title carries it).
          display: !isCircular && seriesCount > 1,
          position: "top",
          align: "end",
          labels: {
            color: PALETTE.muted,
            font: { family: FONT_FAMILY, size: 12 },
            usePointStyle: true,
            boxHeight: 8,
            boxWidth: 8,
            padding: 16,
          },
        },
        datalabels: {
          // Inline number labels on bars and pie slices — the readability win.
          display: !isLine,
          color: isCircular ? PALETTE.background : PALETTE.ink,
          anchor: isCircular ? "center" : "end",
          align: isCircular ? "center" : isHorizontalBar ? "right" : "top",
          offset: isCircular ? 0 : 4,
          clamp: true,
          font: {
            family: FONT_FAMILY,
            size: isCircular ? 13 : 12,
            weight: "500",
          },
          formatter: formatDataLabel,
        },
        tooltip: { enabled: false },
      },
      scales: isCircular
        ? undefined
        : {
            x: {
              grid: {
                display: !isHorizontalBar,
                color: PALETTE.grid,
                drawBorder: false,
                drawTicks: false,
              },
              border: { display: false },
              ticks: {
                color: PALETTE.muted,
                font: { family: FONT_FAMILY, size: 11 },
                padding: 8,
              },
            },
            y: {
              grid: {
                display: isHorizontalBar ? false : true,
                color: PALETTE.grid,
                drawBorder: false,
                drawTicks: false,
              },
              border: { display: false },
              ticks: {
                color: PALETTE.muted,
                font: { family: FONT_FAMILY, size: 11 },
                padding: 8,
              },
              beginAtZero: true,
            },
          },
    },
  };

  const params = new URLSearchParams({
    c: JSON.stringify(config),
    width: "1200",
    height: "675",
    backgroundColor: PALETTE.background,
    devicePixelRatio: "2",
    version: "4",
  });

  const response = await fetch(`https://quickchart.io/chart?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`QuickChart returned ${response.status}: ${await response.text()}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
};
