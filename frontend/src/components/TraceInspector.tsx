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
  ALLOWED: "border-white/[0.12] bg-[#18181B] text-zinc-200",
  CACHED: "border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981]",
  PII_MASKED: "border-[#F59E0B]/30 bg-[#F59E0B]/10 text-[#F59E0B]",
  BLOCKED: "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]",
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-[#111113] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-mono text-xs text-zinc-400">
            <Filter className="h-3.5 w-3.5 text-zinc-500" />
            Status:
          </span>
          {["ALL", "ALLOWED", "CACHED", "PII_MASKED", "BLOCKED"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                statusFilter === st
                  ? "border-transparent bg-[#FAFAFA] font-medium text-[#09090B]"
                  : "border-white/[0.07] bg-[#09090B] text-zinc-400 hover:border-white/20 hover:text-zinc-200"
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
            className="rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#FAFAFA] focus:border-white/30 focus:outline-none"
          >
            <option value="ALL">All Models</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="claude-sonnet-4">claude-sonnet-4</option>
          </select>

          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search prompt, tenant, ID..."
              className="w-52 rounded-md border border-white/[0.08] bg-[#09090B] py-1.5 pl-8 pr-3 font-mono text-xs text-[#FAFAFA] placeholder-zinc-500 focus:border-white/30 focus:outline-none"
            />
          </div>

          <a
            href={csvExportUrl}
            download="aegis_audit_traces.csv"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] bg-[#18181B] px-3 py-1.5 font-mono text-xs font-medium text-zinc-200 transition-colors hover:border-white/20 hover:bg-zinc-800"
          >
            <Download className="h-3.5 w-3.5 text-zinc-400" />
            Export Audit CSV
          </a>

          <a
            href={jsonExportUrl}
            download="aegis_audit_traces.json"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.09] bg-[#18181B] px-2.5 py-1.5 font-mono text-xs text-zinc-300 transition-colors hover:border-white/20 hover:bg-zinc-800"
          >
            JSON
          </a>
        </div>
      </div>

      {/* Trace Table */}
      <div className="overflow-hidden rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-2.5 font-mono text-[11px] tabular-nums text-zinc-400">
          <span>
            Showing {traces.length} of {total} audit traces
          </span>
          <span className="text-zinc-500">
            Click any row to inspect payload & guardrail telemetry
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.07] bg-[#09090B]/50 font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Tenant</th>
                <th className="px-4 py-3">Model / Route</th>
                <th className="px-4 py-3">Sanitized Payload Preview</th>
                <th className="px-4 py-3 text-right">TTFT / Total</th>
                <th className="px-4 py-3 text-right">FinOps ($ USD)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05]">
              {loading && traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center font-mono text-xs text-zinc-500">
                    Loading audit traces...
                  </td>
                </tr>
              ) : traces.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center font-mono text-xs text-zinc-500">
                    No matching traces found for the current filters.
                  </td>
                </tr>
              ) : (
                traces.map((tr) => (
                  <tr
                    key={tr.id}
                    onClick={() => void openDrawer(tr.id)}
                    className="cursor-pointer transition-colors hover:bg-[#18181B]"
                  >
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] tabular-nums text-zinc-400">
                      {new Date(tr.timestamp).toLocaleTimeString()}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-medium ${STATUS_BADGE[tr.status]}`}
                      >
                        <StatusIcon status={tr.status} />
                        {tr.status}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-zinc-300">
                      {tr.tenant_id}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-[#FAFAFA]">
                      <span>{tr.routed_model || tr.model}</span>
                      {tr.fallback_used && (
                        <span className="ml-1.5 inline-flex items-center gap-0.5 rounded border border-[#F59E0B]/30 bg-[#F59E0B]/10 px-1 py-0.5 text-[9px] text-[#F59E0B]">
                          <WifiOff className="h-2.5 w-2.5" />
                          FAILOVER
                        </span>
                      )}
                    </td>
                    <td className="max-w-md truncate px-4 py-3 font-mono text-[11px] text-zinc-300">
                      {tr.prompt_sanitized}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11px] tabular-nums text-zinc-300">
                      {tr.ttft_ms.toFixed(1)} / {tr.latency_ms.toFixed(1)} ms
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-[11px] tabular-nums">
                      {tr.saved_usd > 0 ? (
                        <span className="text-[#10B981]">+${tr.saved_usd.toFixed(5)} saved</span>
                      ) : (
                        <span className="text-zinc-300">${tr.cost_usd.toFixed(5)}</span>
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
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm">
          <div className="flex h-full w-full max-w-xl flex-col border-l border-white/[0.08] bg-[#09090B] shadow-2xl">
            <div className="flex items-center justify-between border-b border-white/[0.07] bg-[#111113] px-6 py-4">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
                  Trace Audit Inspector
                </h3>
                {selectedDetail && (
                  <p className="mt-0.5 font-mono text-[11px] tabular-nums text-zinc-400">
                    ID: {selectedDetail.id}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedDetail(null)}
                className="rounded-md border border-white/[0.08] p-1.5 text-zinc-400 transition-colors hover:bg-[#18181B] hover:text-[#FAFAFA]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {loadingDetail && !selectedDetail ? (
              <div className="p-6 font-mono text-xs text-zinc-400">Loading trace payload...</div>
            ) : selectedDetail ? (
              <div className="flex-1 space-y-5 overflow-y-auto p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-xs font-medium ${STATUS_BADGE[selectedDetail.status]}`}
                  >
                    <StatusIcon status={selectedDetail.status} />
                    {selectedDetail.status}
                  </span>
                  <span className="rounded border border-white/[0.08] bg-[#111113] px-2.5 py-1 font-mono text-xs text-[#FAFAFA]">
                    {selectedDetail.routed_model || selectedDetail.model}
                  </span>
                  {selectedDetail.fallback_used && (
                    <span className="rounded border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-2.5 py-1 font-mono text-xs text-[#F59E0B]">
                      Failover from {selectedDetail.model}
                    </span>
                  )}
                  <span className="rounded border border-white/[0.08] bg-[#111113] px-2.5 py-1 font-mono text-xs text-zinc-300">
                    Tenant: {selectedDetail.tenant_id}
                  </span>
                </div>

                <div className="grid grid-cols-2 divide-y divide-white/[0.07] overflow-hidden rounded-lg border border-white/[0.07] bg-[#111113] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
                  <div className="p-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      TTFT
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[#FAFAFA]">
                      {selectedDetail.ttft_ms.toFixed(1)} ms
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Total Lat
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-200">
                      {selectedDetail.latency_ms.toFixed(1)} ms
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      Tokens In/Out
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-zinc-200">
                      {selectedDetail.tokens_in} / {selectedDetail.tokens_out}
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                      EvalOps
                    </div>
                    <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[#10B981]">
                      {(selectedDetail.eval_score * 100).toFixed(0)}%
                    </div>
                  </div>
                </div>

                {(selectedDetail.pii_entities.length > 0 ||
                  selectedDetail.threat_categories.length > 0) && (
                  <div className="space-y-2 rounded-lg border border-white/[0.07] bg-[#111113] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
                    <div className="font-mono text-[11px] font-medium uppercase tracking-wider text-zinc-400">
                      Guardrail Alerts & Entities
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selectedDetail.pii_entities.map((ent) => (
                        <span
                          key={ent}
                          className="rounded border border-[#F59E0B]/35 bg-[#F59E0B]/10 px-2 py-0.5 font-mono text-[11px] text-[#F59E0B]"
                        >
                          PII: {ent}
                        </span>
                      ))}
                      {selectedDetail.threat_categories.map((thr) => (
                        <span
                          key={thr}
                          className="rounded border border-[#EF4444]/35 bg-[#EF4444]/10 px-2 py-0.5 font-mono text-[11px] text-[#EF4444]"
                        >
                          THREAT: {thr}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                    Sanitized Prompt (Sent Upstream)
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-[#111113] p-3.5 font-mono text-xs text-zinc-200">
                    {selectedDetail.prompt_sanitized}
                  </pre>
                </div>

                {selectedDetail.prompt_original !== selectedDetail.prompt_sanitized && (
                  <div className="space-y-2">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-[#F59E0B]">
                      Original Ingress Payload (Intercepted Pre-Flight)
                    </div>
                    <pre className="whitespace-pre-wrap rounded-lg border border-[#F59E0B]/30 bg-[#F59E0B]/10 p-3.5 font-mono text-xs text-zinc-100">
                      {selectedDetail.prompt_original}
                    </pre>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">
                    Gateway Response Preview
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg border border-white/[0.07] bg-[#111113] p-3.5 font-mono text-xs text-zinc-200">
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
