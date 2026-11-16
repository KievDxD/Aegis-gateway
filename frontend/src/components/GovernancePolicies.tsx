import { useEffect, useState } from "react";
import {
  Check,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  Save,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Trash2,
} from "lucide-react";
import {
  createVirtualKey,
  fetchVirtualKeys,
  revokeVirtualKey,
  runRedTeamBenchmark,
  updatePolicy,
} from "../services/api";
import type { RedTeamBenchmarkResponse, TenantPolicy, VirtualKey } from "../types/aegis";

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

  // Virtual API Keys state
  const [keys, setKeys] = useState<VirtualKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyTenant, setNewKeyTenant] = useState("default");
  const [creatingKey, setCreatingKey] = useState(false);
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // OWASP Red-Team Audit state
  const [auditing, setAuditing] = useState(false);
  const [auditReport, setAuditReport] = useState<RedTeamBenchmarkResponse | null>(null);

  useEffect(() => {
    const match =
      policies.find((p) => p.tenant_id === selectedTenantId) ?? policies[0] ?? null;
    if (match) {
      setSelectedTenantId(match.tenant_id);
      setDraft({ ...match });
    }
  }, [policies, selectedTenantId]);

  useEffect(() => {
    let active = true;
    const loadKeys = async () => {
      try {
        const list = await fetchVirtualKeys();
        if (active) setKeys(list);
      } catch {
        // Ignore transient network errors
      }
    };
    void loadKeys();
    return () => {
      active = false;
    };
  }, []);

  const handleSelectTenant = (id: string) => {
    setSelectedTenantId(id);
    setNewKeyTenant(id);
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

  const handleCreateKey = async () => {
    if (!newKeyName.trim() || creatingKey) return;
    setCreatingKey(true);
    setCreatedSecret(null);
    try {
      const created = await createVirtualKey(newKeyName.trim(), newKeyTenant);
      setKeys((prev) => [created, ...prev]);
      setCreatedSecret(created.raw_key);
      setNewKeyName("");
    } finally {
      setCreatingKey(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    const revoked = await revokeVirtualKey(keyId);
    setKeys((prev) => prev.map((k) => (k.id === revoked.id ? revoked : k)));
  };

  const handleCopySecret = async () => {
    if (!createdSecret) return;
    await navigator.clipboard.writeText(createdSecret);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 1800);
  };

  const handleRunRedTeamAudit = async () => {
    if (!draft || auditing) return;
    setAuditing(true);
    try {
      const report = await runRedTeamBenchmark(draft.tenant_id);
      setAuditReport(report);
    } finally {
      setAuditing(false);
    }
  };

  if (!draft) {
    return (
      <div className="rounded-lg border border-white/[0.07] bg-[#111113] p-6 font-mono text-xs text-zinc-400 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        Loading tenant governance policies...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Tenant List */}
        <aside className="rounded-lg border border-white/[0.07] bg-[#111113] p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] lg:col-span-4">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-zinc-400" />
            <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
              Registered Tenants
            </h2>
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
                      ? "border-white/25 bg-[#18181B]"
                      : "border-white/[0.07] bg-[#09090B] hover:border-white/15 hover:bg-[#18181B]/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-semibold text-[#FAFAFA]">
                      {policy.tenant_id}
                    </span>
                    <span className="font-mono text-[11px] tabular-nums text-[#10B981]">
                      ${policy.max_daily_budget_usd.toFixed(0)}/day
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-zinc-400">{policy.name}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-[10px] tabular-nums text-zinc-400">
                    <span className="rounded border border-white/[0.06] bg-[#111113] px-1.5 py-0.5">
                      Cache ≥ {policy.cache_similarity_threshold.toFixed(2)}
                    </span>
                    <span className="rounded border border-white/[0.06] bg-[#111113] px-1.5 py-0.5">
                      Risk ≥ {policy.injection_threshold.toFixed(2)}
                    </span>
                    <span className="rounded border border-white/[0.06] bg-[#111113] px-1.5 py-0.5">
                      {policy.rate_limit_rpm} RPM
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Live Policy Controls */}
        <section className="rounded-lg border border-white/[0.07] bg-[#111113] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] lg:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.07] pb-4">
            <div className="flex items-center gap-2.5">
              <SlidersHorizontal className="h-4 w-4 text-zinc-400" />
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
                  Live Guardrail & FinOps Controls —{" "}
                  <span className="font-mono text-zinc-300">{draft.tenant_id}</span>
                </h2>
                <p className="mt-0.5 text-xs text-zinc-400">{draft.name}</p>
              </div>
            </div>

            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="inline-flex items-center gap-2 rounded-md bg-[#FAFAFA] px-4 py-2 text-xs font-medium text-[#09090B] transition-colors hover:bg-zinc-200 disabled:opacity-50"
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
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-[#10B981]/30 bg-[#10B981]/10 px-3.5 py-2.5 font-mono text-xs text-[#10B981]">
              <Check className="h-4 w-4" />
              {savedBanner}
            </div>
          )}

          <div className="mt-6 space-y-5">
            <div className="rounded-lg border border-white/[0.07] bg-[#09090B] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-[#FAFAFA]">
                    Semantic Cache Cosine Similarity Threshold
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    Minimum vector similarity (0.80 – 0.99) required to serve cached responses
                  </p>
                </div>
                <span className="font-mono text-base font-semibold tabular-nums text-[#FAFAFA]">
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
                className="mt-3 w-full accent-[#FAFAFA]"
              />
            </div>

            <div className="rounded-lg border border-white/[0.07] bg-[#09090B] p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-[#FAFAFA]">
                    Prompt Injection Firewall Sensitivity
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    Lower threshold blocks more aggressively (0.30 strict – 0.95 permissive)
                  </p>
                </div>
                <span className="font-mono text-base font-semibold tabular-nums text-[#EF4444]">
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
                className="mt-3 w-full accent-[#FAFAFA]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/[0.07] bg-[#09090B] p-4 transition-colors hover:border-white/15">
                <div>
                  <div className="text-xs font-medium text-[#FAFAFA]">
                    Real-Time DLP & PII Redaction
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    Mask cards, IDs, emails & keys pre-flight
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.pii_redaction_enabled}
                  onChange={(e) =>
                    setDraft({ ...draft, pii_redaction_enabled: e.target.checked })
                  }
                  className="h-4 w-4 accent-[#FAFAFA]"
                />
              </label>

              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-white/[0.07] bg-[#09090B] p-4 transition-colors hover:border-white/15">
                <div>
                  <div className="text-xs font-medium text-[#FAFAFA]">
                    Semantic Cache Engine
                  </div>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                    Serve matched embeddings at &lt;15ms latency
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={draft.cache_enabled}
                  onChange={(e) => setDraft({ ...draft, cache_enabled: e.target.checked })}
                  className="h-4 w-4 accent-[#FAFAFA]"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-white/[0.07] bg-[#09090B] p-4">
                <label className="block text-xs font-medium text-[#FAFAFA]">
                  Rate Limit Quota (RPM)
                </label>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
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
                  className="mt-2.5 w-full rounded-md border border-white/[0.08] bg-[#111113] px-3 py-1.5 font-mono text-sm tabular-nums text-[#FAFAFA] focus:border-white/30 focus:outline-none"
                />
              </div>

              <div className="rounded-lg border border-white/[0.07] bg-[#09090B] p-4">
                <label className="block text-xs font-medium text-[#FAFAFA]">
                  Max Daily FinOps Budget ($ USD)
                </label>
                <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                  Hard daily spend cap per tenant UTC day
                </p>
                <input
                  type="number"
                  min={0}
                  max={100000}
                  step={5}
                  value={draft.max_daily_budget_usd}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      max_daily_budget_usd: Math.max(0, Number(e.target.value)),
                    })
                  }
                  className="mt-2.5 w-full rounded-md border border-white/[0.08] bg-[#111113] px-3 py-1.5 font-mono text-sm tabular-nums text-[#10B981] focus:border-white/30 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* Virtual API Keys (SHA-256) Management */}
      <section className="rounded-lg border border-white/[0.07] bg-[#111113] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 text-zinc-400" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
                Virtual API Keys (SHA-256 Zero-Trust Provisioning)
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                Authenticate via Authorization: Bearer ag-live-... with instant revocation
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder="Key label (e.g. Prod Agent)"
              className="w-48 rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#FAFAFA] placeholder-zinc-500 focus:border-white/30 focus:outline-none"
            />
            <select
              value={newKeyTenant}
              onChange={(e) => setNewKeyTenant(e.target.value)}
              className="rounded-md border border-white/[0.08] bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#FAFAFA] focus:border-white/30 focus:outline-none"
            >
              {policies.map((p) => (
                <option key={p.tenant_id} value={p.tenant_id}>
                  {p.tenant_id}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={creatingKey || !newKeyName.trim()}
              onClick={() => void handleCreateKey()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#FAFAFA] px-3.5 py-1.5 text-xs font-medium text-[#09090B] transition-colors hover:bg-zinc-200 disabled:opacity-50"
            >
              {creatingKey ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              <span>Generate Key</span>
            </button>
          </div>
        </div>

        {/* One-time raw key copy banner */}
        {createdSecret && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#10B981]/35 bg-[#10B981]/10 p-3.5">
            <div>
              <div className="font-mono text-xs font-semibold text-[#10B981]">
                Virtual API Key Generated — Copy Now (Shown Once)
              </div>
              <code className="mt-1 block font-mono text-xs text-[#FAFAFA]">{createdSecret}</code>
            </div>
            <button
              type="button"
              onClick={() => void handleCopySecret()}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#10B981]/40 bg-[#09090B] px-3 py-1.5 font-mono text-xs text-[#10B981] transition-colors hover:bg-[#18181B]"
            >
              {copiedKey ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedKey ? "Copied" : "Copy Secret"}
            </button>
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-white/[0.07] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="py-2.5 pr-4">Key Name</th>
                <th className="py-2.5 pr-4">Tenant</th>
                <th className="py-2.5 pr-4">Key Prefix</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Last Used</th>
                <th className="py-2.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.05] font-mono text-[11px]">
              {keys.map((vk) => (
                <tr key={vk.id} className="transition-colors hover:bg-[#18181B]/70">
                  <td className="py-2.5 pr-4 font-sans text-xs font-medium text-[#FAFAFA]">
                    {vk.name}
                  </td>
                  <td className="py-2.5 pr-4 text-zinc-300">{vk.tenant_id}</td>
                  <td className="py-2.5 pr-4 text-zinc-400">{vk.key_prefix}</td>
                  <td className="py-2.5 pr-4">
                    <span
                      className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
                        vk.is_active
                          ? "border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981]"
                          : "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]"
                      }`}
                    >
                      {vk.is_active ? "ACTIVE" : "REVOKED"}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums text-zinc-400">
                    {vk.last_used_at ? new Date(vk.last_used_at).toLocaleString() : "Never"}
                  </td>
                  <td className="py-2.5 text-right">
                    {vk.is_active ? (
                      <button
                        type="button"
                        onClick={() => void handleRevokeKey(vk.id)}
                        className="inline-flex items-center gap-1 rounded border border-[#EF4444]/35 bg-[#EF4444]/10 px-2.5 py-1 text-[10px] font-medium text-[#EF4444] transition-colors hover:bg-[#EF4444]/20"
                      >
                        <Trash2 className="h-3 w-3" />
                        Revoke
                      </button>
                    ) : (
                      <span className="text-[10px] text-zinc-600">Disabled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* OWASP LLM Red-Team Security Benchmark */}
      <section className="rounded-lg border border-white/[0.07] bg-[#111113] p-6 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] pb-4">
          <div className="flex items-center gap-2.5">
            <Swords className="h-4 w-4 text-zinc-400" />
            <div>
              <h2 className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
                OWASP LLM Red-Team Adversarial Security Audit
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-zinc-500">
                Tests 10 real-world injection, jailbreak, system prompt & PII exfiltration vectors
                against <span className="text-zinc-200">{draft.tenant_id}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={auditing}
            onClick={() => void handleRunRedTeamAudit()}
            className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-[#18181B] px-4 py-2 text-xs font-medium text-[#FAFAFA] transition-colors hover:bg-zinc-800 disabled:opacity-50"
          >
            {auditing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Swords className="h-3.5 w-3.5" />
            )}
            <span>{auditing ? "Running 10 Vectors..." : "Run OWASP LLM Red-Team Audit"}</span>
          </button>
        </div>

        {auditReport && (
          <div className="mt-5 space-y-4">
            <div
              className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4 ${
                auditReport.status === "HARDENED"
                  ? "border-[#10B981]/35 bg-[#10B981]/10"
                  : auditReport.status === "DEGRADED"
                    ? "border-[#F59E0B]/35 bg-[#F59E0B]/10"
                    : "border-[#EF4444]/35 bg-[#EF4444]/10"
              }`}
            >
              <div className="flex items-center gap-3">
                {auditReport.status === "HARDENED" ? (
                  <ShieldCheck className="h-6 w-6 text-[#10B981]" />
                ) : (
                  <ShieldAlert
                    className={`h-6 w-6 ${
                      auditReport.status === "DEGRADED" ? "text-[#F59E0B]" : "text-[#EF4444]"
                    }`}
                  />
                )}
                <div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-[#FAFAFA]">
                    {auditReport.compliance_score.toFixed(1)}% {auditReport.status}
                  </div>
                  <div className="font-mono text-[11px] tabular-nums text-zinc-300">
                    {auditReport.passed_count} / {auditReport.total_attacks} adversarial probes
                    defended · Threshold ≥ {auditReport.injection_threshold.toFixed(2)} · DLP{" "}
                    {auditReport.pii_redaction_enabled ? "ON" : "OFF"}
                  </div>
                </div>
              </div>
              <span className="rounded border border-white/[0.08] bg-[#09090B] px-2.5 py-1 font-mono text-xs text-zinc-200">
                Tenant: {auditReport.tenant_id}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.07] font-mono text-[10px] uppercase tracking-wider text-zinc-500">
                    <th className="py-2.5 pr-3">ID</th>
                    <th className="py-2.5 pr-4">OWASP Vector</th>
                    <th className="py-2.5 pr-4">Probe Sample (Masked)</th>
                    <th className="py-2.5 pr-4">Expected → Actual</th>
                    <th className="py-2.5 pr-4 text-right">Risk</th>
                    <th className="py-2.5 text-right">Verdict</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] font-mono text-[11px]">
                  {auditReport.vectors.map((vec) => (
                    <tr key={vec.id} className="transition-colors hover:bg-[#18181B]/70">
                      <td className="py-2.5 pr-3 font-medium text-[#FAFAFA]">{vec.id}</td>
                      <td className="py-2.5 pr-4">
                        <div className="font-sans text-xs font-medium text-[#FAFAFA]">
                          {vec.title}
                        </div>
                        <div className="text-[10px] text-zinc-500">{vec.category}</div>
                      </td>
                      <td className="max-w-xs truncate py-2.5 pr-4 text-zinc-400">
                        {vec.attack_sample_masked}
                      </td>
                      <td className="py-2.5 pr-4 text-zinc-300">
                        {vec.expected_action} → {vec.actual_action}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-zinc-300">
                        {vec.risk_score.toFixed(2)}
                      </td>
                      <td className="py-2.5 text-right">
                        <span
                          className={`rounded border px-2 py-0.5 text-[10px] font-medium ${
                            vec.passed
                              ? "border-[#10B981]/30 bg-[#10B981]/10 text-[#10B981]"
                              : "border-[#EF4444]/30 bg-[#EF4444]/10 text-[#EF4444]"
                          }`}
                        >
                          {vec.passed ? "DEFENDED" : "EXPOSED"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
