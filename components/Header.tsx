"use client";

import React from "react";
import { ShieldAlert, Sun, Moon, Trash2, Activity, CheckCircle2, AlertCircle } from "lucide-react";
import type { HealthStatus } from "@/lib/types";

interface HeaderProps {
  theme: "light" | "dark";
  onToggleTheme: () => void;
  health: HealthStatus | null;
  totalScanned: number;
  onClearHistory: () => void;
}

export default function Header({
  theme,
  onToggleTheme,
  health,
  totalScanned,
  onClearHistory,
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/85 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/85">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm shadow-indigo-500/30">
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white sm:text-lg">
              Real-Time Fake Review Detection
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Scikit-learn TF-IDF + Behavioral Engine &bull; FastAPI Serverless
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* API Health Pill */}
          <div
            className={`hidden items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium sm:flex ${
              health?.status === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300"
            }`}
            title={health?.note || health?.model_type || "Checking backend status"}
          >
            {health?.status === "ok" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>
                  {health.model_loaded
                    ? `ML Model Active${health.accuracy ? ` (${(health.accuracy * 100).toFixed(1)}%)` : ""}`
                    : "Heuristic Fallback"}
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-3.5 w-3.5" />
                <span>API Connecting...</span>
              </>
            )}
          </div>

          {totalScanned > 0 && (
            <button
              type="button"
              onClick={onClearHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-rose-900 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
              title="Clear local session history"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Reset ({totalScanned})</span>
            </button>
          )}

          <button
            type="button"
            onClick={onToggleTheme}
            aria-label="Toggle dark or light theme"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-100 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile health bar */}
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-1.5 text-[11px] text-slate-500 dark:border-slate-900 dark:text-slate-400 sm:hidden">
        <span className="inline-flex items-center gap-1">
          <Activity className="h-3 w-3 text-indigo-500" />
          {health?.status === "ok"
            ? health.model_loaded
              ? "Scikit-learn Pipeline Ready"
              : "Heuristic Fallback Active"
            : "Connecting to FastAPI..."}
        </span>
        <span>{totalScanned} scanned</span>
      </div>
    </header>
  );
}
