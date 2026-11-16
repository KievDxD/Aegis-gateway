import {
  Activity,
  Flame,
  Loader2,
  Shield,
  SlidersHorizontal,
  Terminal,
  Zap,
} from "lucide-react";
import type { ActiveTab } from "../types/aegis";

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onSimulateBurst: () => void;
  simulating: boolean;
  totalRequests: number;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string; icon: typeof Activity }> = [
  { id: "overview", label: "Command Overview", icon: Activity },
  { id: "playground", label: "AI Firewall Playground", icon: Terminal },
  { id: "traces", label: "Live Trace Inspector", icon: Flame },
  { id: "policies", label: "Governance Policies", icon: SlidersHorizontal },
];

export function Navbar({
  activeTab,
  onSelectTab,
  onSimulateBurst,
  simulating,
  totalRequests,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-[#07090d]/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-500/10 shadow-[0_0_20px_rgba(6,182,212,0.18)]">
            <Shield className="h-5 w-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="font-mono text-sm font-bold tracking-[0.16em] text-slate-100">
                AEGIS // GATEWAY
              </span>
              <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-cyan-300">
                Enterprise V2.0
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                ZERO-TRUST ACTIVE
              </span>
              <span className="text-slate-600">|</span>
              <span className="font-mono text-[11px] tabular-nums text-slate-400">
                {totalRequests.toLocaleString()} TRACES INDEXED
              </span>
            </div>
          </div>
        </div>

        <nav className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800/90 bg-[#0b0e14] p-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? "border border-cyan-500/35 bg-cyan-500/15 text-cyan-200 shadow-sm"
                    : "border border-transparent text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active ? "text-cyan-400" : "text-slate-500"}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={onSimulateBurst}
          disabled={simulating}
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-400/50 bg-gradient-to-r from-cyan-500/20 to-emerald-500/15 px-3.5 py-2 text-xs font-semibold text-cyan-100 shadow-[0_0_24px_rgba(6,182,212,0.16)] transition-all hover:border-cyan-300/70 hover:from-cyan-500/30 hover:to-emerald-500/25 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {simulating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
          ) : (
            <Zap className="h-3.5 w-3.5 text-cyan-300" />
          )}
          <span>{simulating ? "Injecting Traffic..." : "Simulate Live Traffic Burst"}</span>
        </button>
      </div>
    </header>
  );
}
