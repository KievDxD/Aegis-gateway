import { useState } from "react";
import {
  Clock,
  Cpu,
  DatabaseZap,
  DollarSign,
  EyeOff,
  ShieldAlert,
  TrendingDown,
} from "lucide-react";
import type { AdminMetricsResponse } from "../types/aegis";

interface CommandOverviewProps {
  metrics: AdminMetricsResponse | null;
  loading: boolean;
  onNavigateTraces: (statusFilter?: string) => void;
}

export function CommandOverview({
  metrics,
  loading,
  onNavigateTraces,
}: CommandOverviewProps) {
  const [hoveredHourIndex, setHoveredHourIndex] = useState<number | null>(null);

  if (loading && !metrics) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div
            key={idx}
            className="h-32 animate-pulse rounded-xl border border-slate-800 bg-[#0b0e14]"
          />
        ))}
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 font-mono text-sm text-rose-300">
        Unable to load telemetry metrics from /api/admin/metrics. Verify backend status.
      </div>
    );
  }

  const totalSpendPlusSaved = metrics.total_cost_usd + metrics.total_saved_usd;
  const savingsEfficiencyPct =
    totalSpendPlusSaved > 0
      ? ((metrics.total_saved_usd / totalSpendPlusSaved) * 100).toFixed(1)
      : "0.0";

  const hourly = metrics.hourly_series;
  const maxRequests = Math.max(1, ...hourly.map((h) => h.requests));
  const maxMoney = Math.max(
    0.0001,
    ...hourly.map((h) => Math.max(h.cost_usd + h.saved_usd, 0.0001))
  );

  const dist = metrics.status_distribution;
  const distItems = [
    { key: "ALLOWED", label: "Allowed Upstream", count: dist.ALLOWED ?? 0, color: "#10b981", bg: "bg-emerald-500" },
    { key: "CACHED", label: "Semantic Cache Hit", count: dist.CACHED ?? 0, color: "#06b6d4", bg: "bg-cyan-400" },
    { key: "PII_MASKED", label: "PII Redacted (DLP)", count: dist.PII_MASKED ?? 0, color: "#f59e0b", bg: "bg-amber-400" },
    { key: "BLOCKED", label: "Firewall Blocked", count: dist.BLOCKED ?? 0, color: "#f43f5e", bg: "bg-rose-500" },
  ];
  const distTotal = Math.max(1, distItems.reduce((acc, item) => acc + item.count, 0));

  // Build SVG Donut arcs
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  let runningOffset = 0;

  const hoveredPoint =
    hoveredHourIndex !== null && hourly[hoveredHourIndex] ? hourly[hoveredHourIndex] : null;

  return (
    <div className="space-y-6">
      {/* Executive KPI Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Net Spend & Savings
            </span>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-100">
              ${metrics.total_cost_usd.toFixed(4)}
            </span>
            <span className="font-mono text-xs tabular-nums text-emerald-400">
              +${metrics.total_saved_usd.toFixed(4)} saved
            </span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400/90">
            <TrendingDown className="h-3.5 w-3.5" />
            <span className="font-mono text-[11px]">
              {savingsEfficiencyPct}% FinOps cost reduction
            </span>
          </div>
        </div>

        <div
          onClick={() => onNavigateTraces("CACHED")}
          className="cursor-pointer rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4 shadow-lg transition-colors hover:border-cyan-500/40"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Semantic Cache Hit Rate
            </span>
            <DatabaseZap className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-cyan-300">
              {metrics.cache_hit_rate_pct.toFixed(1)}%
            </span>
            <span className="font-mono text-xs tabular-nums text-slate-400">
              ({metrics.cached_requests} hits)
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500"
              style={{ width: `${Math.min(100, metrics.cache_hit_rate_pct)}%` }}
            />
          </div>
        </div>

        <div
          onClick={() => onNavigateTraces("BLOCKED")}
          className="cursor-pointer rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4 shadow-lg transition-colors hover:border-rose-500/40"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Threats Blocked
            </span>
            <ShieldAlert className="h-4 w-4 text-rose-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-rose-400">
              {metrics.blocked_requests}
            </span>
            <span className="font-mono text-xs text-slate-400">pre-flight</span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-rose-300/80">
            Zero-Trust injection & jailbreak firewall
          </p>
        </div>

        <div
          onClick={() => onNavigateTraces("PII_MASKED")}
          className="cursor-pointer rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4 shadow-lg transition-colors hover:border-amber-500/40"
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              PII Entities Redacted
            </span>
            <EyeOff className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-amber-300">
              {metrics.total_pii_redacted}
            </span>
            <span className="font-mono text-xs text-slate-400">
              across {metrics.pii_masked_requests} traces
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-amber-300/80">
            Cards (Luhn), IDs, Emails & API Keys
          </p>
        </div>

        <div className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
              Avg TTFT & EvalOps
            </span>
            <Clock className="h-4 w-4 text-cyan-400" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-slate-100">
              {metrics.avg_ttft_ms.toFixed(1)} ms
            </span>
            <span className="font-mono text-xs tabular-nums text-emerald-400">
              Eval {(metrics.avg_eval_score * 100).toFixed(0)}%
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-slate-400">
            E2E Avg Latency: {metrics.avg_latency_ms.toFixed(1)} ms
          </p>
        </div>
      </section>

      {/* Native SVG Telemetry Charts */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* 12-Hour Traffic & FinOps Cost/Savings SVG Chart */}
        <div className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Gateway Request Volume & FinOps Velocity (12H UTC)
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                Cyan bars: total requests · Emerald line: USD saved by cache/firewall · Crimson dots: blocked attacks
              </p>
            </div>
            {hoveredPoint ? (
              <div className="rounded-lg border border-slate-700 bg-[#10151e] px-3 py-1.5 font-mono text-[11px] text-slate-200">
                <span className="text-cyan-300">{hoveredPoint.hour} UTC</span> ·{" "}
                <span>{hoveredPoint.requests} req</span> ·{" "}
                <span className="text-emerald-400">${hoveredPoint.saved_usd.toFixed(4)} saved</span> ·{" "}
                <span className="text-rose-400">{hoveredPoint.blocked} blocked</span>
              </div>
            ) : (
              <div className="flex items-center gap-4 font-mono text-[11px] text-slate-400">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-sm bg-cyan-500" /> Requests
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" /> Savings
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500" /> Blocked
                </span>
              </div>
            )}
          </div>

          <div className="mt-5 w-full overflow-x-auto">
            <svg viewBox="0 0 720 230" className="h-56 w-full min-w-[540px]">
              {/* Horizontal reference lines */}
              {[0.25, 0.5, 0.75, 1].map((step) => {
                const y = 190 - step * 155;
                return (
                  <g key={step}>
                    <line
                      x1="36"
                      y1={y}
                      x2="704"
                      y2={y}
                      stroke="#1e2837"
                      strokeDasharray="3 4"
                      strokeWidth="1"
                    />
                    <text
                      x="30"
                      y={y + 3}
                      textAnchor="end"
                      fill="#64748b"
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {Math.round(maxRequests * step)}
                    </text>
                  </g>
                );
              })}

              {/* Bars and hover zones */}
              {hourly.map((point, idx) => {
                const slotWidth = 660 / Math.max(1, hourly.length);
                const x = 42 + idx * slotWidth;
                const barW = Math.max(14, slotWidth - 18);
                const barH = (point.requests / maxRequests) * 155;
                const y = 190 - barH;
                const isHovered = hoveredHourIndex === idx;

                return (
                  <g
                    key={point.hour}
                    onMouseEnter={() => setHoveredHourIndex(idx)}
                    onMouseLeave={() => setHoveredHourIndex(null)}
                    className="cursor-pointer"
                  >
                    <rect
                      x={x}
                      y={24}
                      width={slotWidth}
                      height={180}
                      fill={isHovered ? "rgba(6, 182, 212, 0.05)" : "transparent"}
                    />
                    <rect
                      x={x + (slotWidth - barW) / 2 - 4}
                      y={y}
                      width={barW}
                      height={Math.max(2, barH)}
                      rx={4}
                      fill={isHovered ? "#22d3ee" : "#0891b2"}
                      fillOpacity={point.requests > 0 ? 0.72 : 0.18}
                    />
                    {point.blocked > 0 && (
                      <circle
                        cx={x + (slotWidth - barW) / 2 - 4 + barW / 2}
                        cy={Math.max(28, y - 8)}
                        r={4}
                        fill="#f43f5e"
                      />
                    )}
                    <text
                      x={x + slotWidth / 2 - 4}
                      y={212}
                      textAnchor="middle"
                      fill={isHovered ? "#e2e8f0" : "#64748b"}
                      fontSize="10"
                      fontFamily="monospace"
                    >
                      {point.hour}
                    </text>
                  </g>
                );
              })}

              {/* Savings Trend Polyline */}
              {hourly.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={hourly
                    .map((point, idx) => {
                      const slotWidth = 660 / hourly.length;
                      const cx = 42 + idx * slotWidth + slotWidth / 2 - 4;
                      const cy = 190 - ((point.saved_usd / maxMoney) * 140);
                      return `${cx},${cy}`;
                    })
                    .join(" ")}
                />
              )}
            </svg>
          </div>
        </div>

        {/* Security & Cache Event Distribution */}
        <div className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-5">
          <h2 className="text-sm font-semibold text-slate-100">
            Policy Enforcement Breakdown
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">
            Real-time gateway traffic verdicts
          </p>

          <div className="my-5 flex items-center justify-center">
            <div className="relative flex h-36 w-36 items-center justify-center">
              <svg viewBox="0 0 140 140" className="h-36 w-36 -rotate-90">
                <circle
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke="#151c27"
                  strokeWidth="16"
                />
                {distItems.map((item) => {
                  const dashLen = (item.count / distTotal) * circumference;
                  const dashArray = `${dashLen} ${circumference - dashLen}`;
                  const dashOffset = -runningOffset;
                  runningOffset += dashLen;
                  if (item.count === 0) return null;
                  return (
                    <circle
                      key={item.key}
                      cx="70"
                      cy="70"
                      r={radius}
                      fill="none"
                      stroke={item.color}
                      strokeWidth="16"
                      strokeDasharray={dashArray}
                      strokeDashoffset={dashOffset}
                    />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="font-mono text-xl font-bold tabular-nums text-slate-100">
                  {metrics.total_requests}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
                  Events
                </span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {distItems.map((item) => {
              const pct = ((item.count / distTotal) * 100).toFixed(1);
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onNavigateTraces(item.key)}
                  className="block w-full rounded-lg border border-transparent p-1.5 text-left transition-colors hover:border-slate-800 hover:bg-slate-900/60"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-2 text-slate-300">
                      <span className={`h-2 w-2 rounded-full ${item.bg}`} />
                      {item.label}
                    </span>
                    <span className="font-mono tabular-nums text-slate-200">
                      {item.count} <span className="text-slate-500">({pct}%)</span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div
                      className={`h-full rounded-full ${item.bg}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Model FinOps Attribution Table */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-cyan-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Multi-Model FinOps Cost Attribution
            </h2>
          </div>
          <span className="font-mono text-[11px] text-slate-400">
            Aggregated across all active tenants
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 font-mono text-[11px] uppercase tracking-wider text-slate-400">
                <th className="pb-2.5 pr-4">Model ID</th>
                <th className="pb-2.5 pr-4 text-right">Requests</th>
                <th className="pb-2.5 pr-4 text-right">Tokens Metered</th>
                <th className="pb-2.5 pr-4 text-right">Actual Spend ($ USD)</th>
                <th className="pb-2.5 text-right">Cache & Firewall Savings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 font-mono">
              {metrics.model_breakdown.map((row) => (
                <tr key={row.model} className="hover:bg-slate-900/40">
                  <td className="py-2.5 pr-4 font-semibold text-cyan-300">{row.model}</td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-200">
                    {row.requests}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-400">
                    {row.tokens_total.toLocaleString()}
                  </td>
                  <td className="py-2.5 pr-4 text-right tabular-nums text-slate-200">
                    ${row.cost_usd.toFixed(6)}
                  </td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-400">
                    +${row.saved_usd.toFixed(6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
