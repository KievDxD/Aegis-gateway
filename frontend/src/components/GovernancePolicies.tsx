import { useEffect, useState } from "react";
import { Check, Loader2, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { updatePolicy } from "../services/api";
import type { TenantPolicy } from "../types/aegis";

interface GovernancePoliciesProps {
  policies: TenantPolicy[];
  onPolicySaved: (updated: TenantPolicy) => void;
}

export function GovernancePolicies({
  policies,
  onPolicySaved,
}: GovernancePoliciesProps) {
  const [selectedTenantId, setSelectedTenantId] = useState<string>("default");
  const [draft, setDraft] = useState<TenantPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState<string | null>(null);

  useEffect(() => {
    const match =
      policies.find((p) => p.tenant_id === selectedTenantId) ?? policies[0] ?? null;
    if (match) {
      setSelectedTenantId(match.tenant_id);
      setDraft({ ...match });
    }
  }, [policies, selectedTenantId]);

  const handleSelectTenant = (id: string) => {
    setSelectedTenantId(id);
    setSavedBanner(null);
    const match = policies.find((p) => p.tenant_id === id);
    if (match) setDraft({ ...match });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSavedBanner(null);
    try {
      const updated = await updatePolicy(draft.tenant_id, {
        injection_threshold: draft.injection_threshold,
        pii_redaction_enabled: draft.pii_redaction_enabled,
        cache_enabled: draft.cache_enabled,
        cache_similarity_threshold: draft.cache_similarity_threshold,
        rate_limit_rpm: draft.rate_limit_rpm,
        max_daily_budget_usd: draft.max_daily_budget_usd,
      });
      onPolicySaved(updated);
      setDraft(updated);
      setSavedBanner(`Policy synced live for tenant "${updated.tenant_id}".`);
    } finally {
      setSaving(false);
    }
  };

  if (!draft) {
    return (
      <div className="rounded-xl border border-slate-800 bg-[#0b0e14] p-6 font-mono text-xs text-slate-400">
        Loading tenant governance policies...
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Tenant List */}
      <aside className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-4 lg:col-span-4">
        <div className="mb-3 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-cyan-400" />
          <h2 className="text-sm font-semibold text-slate-100">Registered Tenants</h2>
        </div>
        <div className="space-y-2">
          {policies.map((policy) => {
            const active = policy.tenant_id === draft.tenant_id;
            return (
              <button
                key={policy.tenant_id}
                type="button"
                onClick={() => handleSelectTenant(policy.tenant_id)}
                className={`w-full rounded-lg border p-3 text-left transition-all ${
                  active
                    ? "border-cyan-500/50 bg-cyan-500/10"
                    : "border-slate-800 bg-[#07090d] hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold text-slate-100">
                    {policy.tenant_id}
                  </span>
                  <span className="font-mono text-[10px] text-emerald-400">
                    ${policy.max_daily_budget_usd.toFixed(0)}/day
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{policy.name}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] text-slate-400">
                  <span className="rounded bg-slate-800/80 px-1.5 py-0.5">
                    Cache ≥ {policy.cache_similarity_threshold.toFixed(2)}
                  </span>
                  <span className="rounded bg-slate-800/80 px-1.5 py-0.5">
                    Risk ≥ {policy.injection_threshold.toFixed(2)}
                  </span>
                  <span className="rounded bg-slate-800/80 px-1.5 py-0.5">
                    {policy.rate_limit_rpm} RPM
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* Live Policy Controls */}
      <section className="rounded-xl border border-slate-800/90 bg-[#0b0e14] p-6 lg:col-span-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <SlidersHorizontal className="h-4 w-4 text-cyan-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-100">
                Live Guardrail & FinOps Controls —{" "}
                <span className="font-mono text-cyan-300">{draft.tenant_id}</span>
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">{draft.name}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSave()}
            className="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-cyan-400 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            <span>{saving ? "Applying Policy..." : "Save Live Policy"}</span>
          </button>
        </div>

        {savedBanner && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 font-mono text-xs text-emerald-300">
            <Check className="h-4 w-4" />
            {savedBanner}
          </div>
        )}

        <div className="mt-6 space-y-6">
          {/* Semantic Cache Threshold Slider */}
          <div className="rounded-lg border border-slate-800 bg-[#07090d] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Semantic Cache Cosine Similarity Threshold
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  Minimum vector similarity (0.80 – 0.99) required to serve cached responses
                </p>
              </div>
              <span className="font-mono text-base font-bold tabular-nums text-cyan-300">
                {draft.cache_similarity_threshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.8}
              max={0.99}
              step={0.01}
              value={draft.cache_similarity_threshold}
              onChange={(e) =>
                setDraft({ ...draft, cache_similarity_threshold: Number(e.target.value) })
              }
              className="mt-3 w-full accent-cyan-400"
            />
          </div>

          {/* Prompt Injection Risk Threshold Slider */}
          <div className="rounded-lg border border-slate-800 bg-[#07090d] p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Prompt Injection Firewall Sensitivity
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  Lower threshold blocks more aggressively (0.30 strict – 0.95 permissive)
                </p>
              </div>
              <span className="font-mono text-base font-bold tabular-nums text-rose-400">
                {draft.injection_threshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0.3}
              max={0.95}
              step={0.01}
              value={draft.injection_threshold}
              onChange={(e) =>
                setDraft({ ...draft, injection_threshold: Number(e.target.value) })
              }
              className="mt-3 w-full accent-rose-500"
            />
          </div>

          {/* Switches */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-800 bg-[#07090d] p-4">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Real-Time DLP & PII Redaction
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  Mask cards, IDs, emails & keys pre-flight
                </p>
              </div>
              <input
                type="checkbox"
                checked={draft.pii_redaction_enabled}
                onChange={(e) =>
                  setDraft({ ...draft, pii_redaction_enabled: e.target.checked })
                }
                className="h-4 w-4 accent-amber-400"
              />
            </label>

            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-slate-800 bg-[#07090d] p-4">
              <div>
                <div className="text-xs font-semibold text-slate-200">
                  Semantic Cache Engine
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                  Serve matched embeddings at &lt;15ms latency
                </p>
              </div>
              <input
                type="checkbox"
                checked={draft.cache_enabled}
                onChange={(e) => setDraft({ ...draft, cache_enabled: e.target.checked })}
                className="h-4 w-4 accent-cyan-400"
              />
            </label>
          </div>

          {/* Numeric Rate Limit & Budget Controls */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-800 bg-[#07090d] p-4">
              <label className="block text-xs font-semibold text-slate-200">
                Rate Limit Quota (RPM)
              </label>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                Requests per minute before HTTP 429 enforcement
              </p>
              <input
                type="number"
                min={1}
                max={10000}
                value={draft.rate_limit_rpm}
                onChange={(e) =>
                  setDraft({ ...draft, rate_limit_rpm: Math.max(1, Number(e.target.value)) })
                }
                className="mt-2.5 w-full rounded-md border border-slate-700 bg-[#0b0e14] px-3 py-1.5 font-mono text-sm text-slate-100 focus:border-cyan-500 focus:outline-none"
              />
            </div>

            <div className="rounded-lg border border-slate-800 bg-[#07090d] p-4">
              <label className="block text-xs font-semibold text-slate-200">
                Max Daily FinOps Budget ($ USD)
              </label>
              <p className="mt-0.5 font-mono text-[11px] text-slate-400">
                Hard daily spend cap per tenant UTC day
              </p>
              <input
                type="number"
                min={1}
                max={100000}
                step={5}
                value={draft.max_daily_budget_usd}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    max_daily_budget_usd: Math.max(0.01, Number(e.target.value)),
                  })
                }
                className="mt-2.5 w-full rounded-md border border-slate-700 bg-[#0b0e14] px-3 py-1.5 font-mono text-sm text-emerald-300 focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
