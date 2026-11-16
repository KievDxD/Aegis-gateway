import { useEffect, useState } from "react";
import {
  CheckCircle2,
  DatabaseZap,
  Download,
  EyeOff,
  Filter,
  Search,
  ShieldAlert,
  WifiOff,
  X,
} from "lucide-react";
import { fetchTraceDetail, fetchTraces, getTracesExportUrl } from "../services/api";
import type { AuditTraceDetail, AuditTraceSummary, TraceStatus } from "../types/aegis";

interface TraceInspectorProps {
  initialStatusFilter: string;
  refreshSignal: number;
}

const STATUS_BADGE: Record<TraceStatus, string> = {
  ALLOWED: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
  CACHED: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
  PII_MASKED: "border-amber-500/40 bg-amber-500/15 text-amber-300",
  BLOCKED: "border-rose-500/40 bg-rose-500/15 text-rose-300",
};

function StatusIcon({ status }: { status: TraceStatus }) {
  if (status === "CACHED") return <DatabaseZap className="h-3 w-3" />;
  if (status === "PII_MASKED") return <EyeOff className="h-3 w-3" />;
  if (status === "BLOCKED") return <ShieldAlert className="h-3 w-3" />;
  return <CheckCircle2 className="h-3 w-3" />;
}

export function TraceInspector({
  initialStatusFilter,
  refreshSignal,
}: TraceInspectorProps) {
  const [traces, setTraces] = useState<AuditTraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState(initialStatusFilter || "ALL");
  const [modelFilter, setModelFilter] = useState("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const [selectedDetail, setSelectedDetail] = useState<AuditTraceDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    setStatusFilter(initialStatusFilter || "ALL");
  }, [initialStatusFilter]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetchTraces({
          status: statusFilter,
          model: modelFilter,
          search: searchQuery,
          limit: 60,
          offset: 0,
        });
        if (active) {
          setTraces(res.items);
          setTotal(res.total);
        }
      } catch {
        // Keep current table rows on transient errors
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [statusFilter, modelFilter, searchQuery, refreshSignal]);

  const openDrawer = async (traceId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await fetchTraceDetail(traceId);
      setSelectedDetail(detail);
    } finally {
      setLoadingDetail(false);
    }
  };

  const csvExportUrl = getTracesExportUrl({
    format: "csv",
    status: statusFilter,
    model: modelFilter,
    search: searchQuery,
  });

  const jsonExportUrl = getTracesExportUrl({
    format: "json",
    status: statusFilter,
    model: modelFilter,
    search: searchQuery,
  });

  return (
    <div className="space-y-4">
      {/* Filter Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-400">
            <Filter className="h-3.5 w-3.5 text-cyan-400" />
            Status:
          </span>
          {["ALL", "ALLOWED", "CACHED", "PII_MASKED", "BLOCKED"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] font-medium transition-colors ${
                statusFilter === st
                  ? "border-cyan-500/50 bg-cyan-500/15 text-cyan-200"
                  : "border-slate-800 bg-[#07090d] text-slate-400 hover:border-slate-700 hover:text-slate-200"
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={modelFilter}
            onChange={(e) => setModelFilter(e.target.value)}
            className="rounded-lg border border-slate-700 bg-[#07090d] px-3 py-1.5 font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
          >
            <option value="ALL">All Models</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="claude-sonnet-4">claude-sonnet-4</option>
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompt, tenant, ID..."
              className="w-52 rounded-lg border border-slate-700 bg-[#07090d] py-1.5 pl-8 pr-3 font-mono text-xs text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <a
            href={csvExportUrl}
            download="aegis_audit_traces.csv"
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 font-mono text-xs font-medium text-emerald-300 transition-colors hover:border-emerald-400/70 hover:bg-emerald-500/20"
          >
            <Download className="h-3.5 w-3.5" />
            Export Audit CSV
          </a>

          <a
            href={jsonExportUrl}
            download="aegis_audit_traces.json"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-[#07090d] px-2.5 py-1.5 font-mono text-xs text-slate-300 transition-colors hover:border-cyan-500/40 hover:text-cyan-200"
          >
            JSON
          </a>
        </div>
      </div>

      {/* Trace Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800/90 bg-[#0b0e14]">
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2.5 font-mono text-[11px] text-slate-400">
          <span>Showing {traces.length} of {total} audit traces</span>
          <span>Click any row to inspect payload & guardrail telemetry</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-[#07090d]/70 font-mono text-[10px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Model / Route</th>
                <th className="px-4 py-3">Sanitized Payload Preview</th>
                <th className="px-4 py-3 text-right">TTFT / Total</th>
                <th className="px-4 py-3 text-right">FinOps ($ USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loading && traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center font-mono text-xs text-slate-500">
                    Loading audit traces...
                  </td>
                </tr>
              ) : traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center font-mono text-xs text-slate-500">
                    No matching traces found for the current filters.
                  </td>
                </tr>
              ) : (
                traces.map((tr) => (
                  <tr
                    key={tr.id}
                    onClick={() => void openDrawer(tr.id)}
                    className="cursor-pointer transition-colors hover:bg-slate-800/40"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-400">
                      {new Date(tr.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${STATUS_BADGE[tr.status]}`}
                      >
                        <StatusIcon status={tr.status} />
                        {tr.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-slate-300">
                      {tr.tenant_id}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-cyan-300">
                      <span>{tr.routed_model || tr.model}</span>
                      {tr.fallback_used && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-1 py-0.5 text-[9px] text-fuchsia-300">
                          <WifiOff className="h-2.5 w-2.5" />
                          FAILOVER
                        </span>
                      )}
                    </td>
                    <td className="max-w-md truncate px-4 py-3 font-mono text-[11px] text-slate-200">
                      {tr.prompt_sanitized}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11px] tabular-nums text-slate-300">
                      {tr.ttft_ms.toFixed(1)} / {tr.latency_ms.toFixed(1)} ms
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11px] tabular-nums">
                      {tr.saved_usd > 0 ? (
                        <span className="text-emerald-400">+${tr.saved_usd.toFixed(5)} saved</span>
                      ) : (
                        <span className="text-slate-300">${tr.cost_usd.toFixed(5)}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-over Trace Inspection Drawer */}
      {(selectedDetail || loadingDetail) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-800 bg-[#07090d] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h3 className="font-mono text-sm font-bold text-slate-100">
                  TRACE AUDIT INSPECTOR
                </h3>
                {selectedDetail && (
                  <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                    ID: {selectedDetail.id}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loadingDetail && !selectedDetail ? (
              <div className="p-6 font-mono text-xs text-slate-400">Loading trace payload...</div>
            ) : selectedDetail ? (
              <div className="flex-1 space-y-5 overflow-y-auto p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs font-semibold ${STATUS_BADGE[selectedDetail.status]}`}
                  >
                    <StatusIcon status={selectedDetail.status} />
                    {selectedDetail.status}
                  </span>
                  <span className="rounded border border-slate-700 bg-[#0b0e14] px-2.5 py-1 font-mono text-xs text-cyan-300">
                    {selectedDetail.routed_model || selectedDetail.model}
                  </span>
                  {selectedDetail.fallback_used && (
                    <span className="rounded border border-fuchsia-500/40 bg-fuchsia-500/15 px-2.5 py-1 font-mono text-xs text-fuchsia-300">
                      Failover from {selectedDetail.model}
                    </span>
                  )}
                  <span className="rounded border border-slate-700 bg-[#0b0e14] px-2.5 py-1 font-mono text-xs text-slate-300">
                    Tenant: {selectedDetail.tenant_id}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border border-slate-800 bg-[#0b0e14] p-3">
                    <div className="font-mono text-[10px] uppercase text-slate-500">TTFT</div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-cyan-300">
                      {selectedDetail.ttft_ms.toFixed(1)} ms
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0b0e14] p-3">
                    <div className="font-mono text-[10px] uppercase text-slate-500">Total Lat</div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-200">
                      {selectedDetail.latency_ms.toFixed(1)} ms
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0b0e14] p-3">
                    <div className="font-mono text-[10px] uppercase text-slate-500">Tokens In/Out</div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-slate-200">
                      {selectedDetail.tokens_in} / {selectedDetail.tokens_out}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-[#0b0e14] p-3">
                    <div className="font-mono text-[10px] uppercase text-slate-500">EvalOps</div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-emerald-400">
                      {(selectedDetail.eval_score * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {(selectedDetail.pii_entities.length > 0 ||
                  selectedDetail.threat_categories.length > 0) && (
                  <div className="space-y-2 rounded-lg border border-slate-800 bg-[#0b0e14] p-4">
                    <div className="font-mono text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                      Guardrail Alerts & Entities
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedDetail.pii_entities.map((ent) => (
                        <span
                          key={ent}
                          className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[11px] text-amber-300"
                        >
                          PII: {ent}
                        </span>
                      ))}
                      {selectedDetail.threat_categories.map((thr) => (
                        <span
                          key={thr}
                          className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 font-mono text-[11px] text-rose-300"
                        >
                          THREAT: {thr}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                    Sanitized Prompt (Sent Upstream)
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0b0e14] p-3.5 font-mono text-xs text-emerald-200">
                    {selectedDetail.prompt_sanitized}
                  </pre>
                </div>

                {selectedDetail.prompt_original !== selectedDetail.prompt_sanitized && (
                  <div className="space-y-2">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-amber-400">
                      Original Ingress Payload (Intercepted Pre-Flight)
                    </div>
                    <pre className="whitespace-pre-wrap rounded-lg border border-amber-500/30 bg-amber-950/15 p-3.5 font-mono text-xs text-amber-100">
                      {selectedDetail.prompt_original}
                    </pre>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-slate-400">
                    Gateway Response Preview
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-slate-800 bg-[#0b0e14] p-3.5 font-mono text-xs text-slate-200">
                    {selectedDetail.response_preview}
                  </pre>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
