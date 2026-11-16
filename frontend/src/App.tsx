import { useCallback, useEffect, useState } from "react";
import { CommandOverview } from "./components/CommandOverview";
import { FirewallPlayground } from "./components/FirewallPlayground";
import { GovernancePolicies } from "./components/GovernancePolicies";
import { Navbar } from "./components/Navbar";
import { TraceInspector } from "./components/TraceInspector";
import {
  fetchAdminMetrics,
  fetchPolicies,
  fetchProvidersHealth,
  simulateTrafficBurst,
} from "./services/api";
import type {
  ActiveTab,
  AdminMetricsResponse,
  ProviderHealthStatus,
  TenantPolicy,
} from "./types/aegis";

export function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [metrics, setMetrics] = useState<AdminMetricsResponse | null>(null);
  const [providersHealth, setProvidersHealth] = useState<ProviderHealthStatus[]>([]);
  const [policies, setPolicies] = useState<TenantPolicy[]>([]);
  const [loadingMetrics, setLoadingMetrics] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [traceStatusFilter, setTraceStatusFilter] = useState("ALL");
  const [refreshSignal, setRefreshSignal] = useState(0);
  const [burstNotice, setBurstNotice] = useState<string | null>(null);

  const loadTelemetry = useCallback(async () => {
    try {
      const [metricsData, policiesData, healthData] = await Promise.all([
        fetchAdminMetrics(),
        fetchPolicies(),
        fetchProvidersHealth(),
      ]);
      setMetrics(metricsData);
      setPolicies(policiesData);
      setProvidersHealth(healthData);
    } catch {
      // Retain prior UI state if backend is restarting
    } finally {
      setLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    void loadTelemetry();
  }, [loadTelemetry, refreshSignal]);

  const handleSimulateBurst = async () => {
    setSimulating(true);
    setBurstNotice(null);
    try {
      const summary = await simulateTrafficBurst(8);
      setBurstNotice(
        `Injected ${summary.generated_count} multi-tenant traces: ` +
          `${summary.breakdown.ALLOWED ?? 0} allowed, ` +
          `${summary.breakdown.CACHED ?? 0} cached, ` +
          `${summary.breakdown.PII_MASKED ?? 0} PII masked, ` +
          `${summary.breakdown.BLOCKED ?? 0} blocked (+$${summary.total_saved_usd.toFixed(4)} saved).`
      );
      setRefreshSignal((prev) => prev + 1);
    } finally {
      setSimulating(false);
    }
  };

  const handleNavigateTraces = (statusFilter = "ALL") => {
    setTraceStatusFilter(statusFilter);
    setActiveTab("traces");
  };

  const handlePolicySaved = (updated: TenantPolicy) => {
    setPolicies((prev) =>
      prev.map((item) => (item.tenant_id === updated.tenant_id ? updated : item))
    );
  };

  return (
    <div className="industrial-grid min-h-screen bg-[#07090d] text-slate-100">
      <Navbar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onSimulateBurst={() => void handleSimulateBurst()}
        simulating={simulating}
        totalRequests={metrics?.total_requests ?? 0}
      />

      <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6">
        {burstNotice && (
          <div className="mb-5 flex items-center justify-between rounded-lg border border-cyan-500/35 bg-cyan-500/10 px-4 py-2.5 font-mono text-xs text-cyan-200">
            <span>{burstNotice}</span>
            <button
              type="button"
              onClick={() => setBurstNotice(null)}
              className="ml-4 text-cyan-400 hover:text-cyan-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {activeTab === "overview" && (
          <CommandOverview
            metrics={metrics}
            providersHealth={providersHealth}
            loading={loadingMetrics}
            onNavigateTraces={handleNavigateTraces}
          />
        )}

        {activeTab === "playground" && (
          <FirewallPlayground
            policies={policies}
            onCompletedRequest={() => setRefreshSignal((prev) => prev + 1)}
          />
        )}

        {activeTab === "traces" && (
          <TraceInspector
            initialStatusFilter={traceStatusFilter}
            refreshSignal={refreshSignal}
          />
        )}

        {activeTab === "policies" && (
          <GovernancePolicies policies={policies} onPolicySaved={handlePolicySaved} />
        )}
      </main>
    </div>
  );
}

export default App;
