import { Loader2, Shield, Zap } from "lucide-react";
import type { ActiveTab } from "../types/aegis";

interface NavbarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onSimulateBurst: () => void;
  simulating: boolean;
  totalRequests: number;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: "overview", label: "Command Overview" },
  { id: "playground", label: "AI Firewall Playground" },
  { id: "traces", label: "Live Trace Inspector" },
  { id: "policies", label: "Governance Policies" },
];

export function Navbar({
  activeTab,
  onSelectTab,
  onSimulateBurst,
  simulating,
  totalRequests,
}: NavbarProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.07] bg-[#09090B]/80 backdrop-blur-md">
      <div className="mx-auto flex min-h-[56px] max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 sm:px-6 lg:h-14 lg:flex-nowrap">
        <div className="flex items-center gap-3 py-2 lg:py-0">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-[#FAFAFA] text-[#09090B]">
            <Shield className="h-3.5 w-3.5 stroke-[2.25]" />
          </div>
          <span className="text-sm font-semibold tracking-tight text-[#FAFAFA]">
            AEGIS // GATEWAY
          </span>
          <span className="hidden text-zinc-700 sm:inline">/</span>
          <div className="hidden items-center gap-2 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#10B981]" />
            <span className="font-mono text-[11px] tabular-nums text-zinc-400">
              {totalRequests.toLocaleString()} traces
            </span>
          </div>
        </div>

        <nav className="order-3 flex w-full items-center gap-5 overflow-x-auto border-t border-white/[0.07] lg:order-2 lg:h-14 lg:w-auto lg:border-t-0">
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                className={`relative flex h-11 shrink-0 items-center border-b-2 text-xs transition-colors lg:h-14 ${
                  active
                    ? "border-[#FAFAFA] font-medium text-[#FAFAFA]"
                    : "border-transparent font-normal text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="order-2 flex items-center py-2 lg:order-3 lg:py-0">
          <button
            type="button"
            onClick={onSimulateBurst}
            disabled={simulating}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#FAFAFA] px-3 py-1.5 text-xs font-medium text-[#09090B] transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {simulating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            <span>{simulating ? "Injecting..." : "Simulate Live Traffic Burst"}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
