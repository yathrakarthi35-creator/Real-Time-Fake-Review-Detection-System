"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  FileSpreadsheet,
  Radio,
  SearchCode,
  ShieldBan,
} from "lucide-react";
import Header from "@/components/Header";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import ReviewAnalyzer from "@/components/ReviewAnalyzer";
import LiveStreamMonitor from "@/components/LiveStreamMonitor";
import BatchScanner from "@/components/BatchScanner";
import ModerationQueue from "@/components/ModerationQueue";
import ReviewDetailDialog from "@/components/ReviewDetailDialog";
import {
  exportReviewsToCsv,
  loadStoredReviews,
  saveStoredReviews,
  THEME_KEY,
  type HealthStatus,
  type ModerationStatus,
  type ScannedReviewRecord,
} from "@/lib/types";

type ActiveTab = "overview" | "inspector" | "stream" | "batch" | "moderation";

function mergeRecords(
  incoming: ScannedReviewRecord[],
  existing: ScannedReviewRecord[]
): ScannedReviewRecord[] {
  const seen = new Set<string>();
  const merged: ScannedReviewRecord[] = [];
  for (const r of [...incoming, ...existing]) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      merged.push(r);
    }
  }
  return merged
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 300);
}

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [records, setRecords] = useState<ScannedReviewRecord[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [sseState, setSseState] = useState<"connected" | "polling" | "connecting">("connecting");
  const [inspectedRecord, setInspectedRecord] = useState<ScannedReviewRecord | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addRecord = useCallback((record: ScannedReviewRecord) => {
    setRecords((prev) => mergeRecords([record], prev));
  }, []);

  const addBatchRecords = useCallback((batch: ScannedReviewRecord[]) => {
    setRecords((prev) => mergeRecords(batch, prev));
  }, []);

  // Hydrate theme + localStorage + SSE subscription
  useEffect(() => {
    const savedTheme = window.localStorage.getItem(THEME_KEY);
    const initialTheme: "light" | "dark" =
      savedTheme === "light" || savedTheme === "dark" ? savedTheme : "dark";
    setTheme(initialTheme);
    document.documentElement.classList.toggle("dark", initialTheme === "dark");

    setRecords(loadStoredReviews());
    setHydrated(true);

    fetch("/api/health")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setHealth(data);
      })
      .catch(() => setHealth(null));

    let es: EventSource | null = null;
    try {
      es = new EventSource("/api/stream/events");

      es.addEventListener("snapshot", (event) => {
        setSseState("connected");
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        const payload = JSON.parse((event as MessageEvent).data);
        if (Array.isArray(payload.records) && payload.records.length > 0) {
          setRecords((prev) => mergeRecords(payload.records, prev));
        }
      });

      es.addEventListener("review", (event) => {
        setSseState("connected");
        if (pollTimerRef.current) {
          clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
        }
        const item: ScannedReviewRecord = JSON.parse((event as MessageEvent).data);
        setRecords((prev) => mergeRecords([item], prev));
      });

      es.addEventListener("moderation", (event) => {
        const updated: ScannedReviewRecord = JSON.parse((event as MessageEvent).data);
        setRecords((prev) =>
          prev.map((r) => (r.id === updated.id ? updated : r))
        );
        setInspectedRecord((curr) => (curr?.id === updated.id ? updated : curr));
      });

      es.addEventListener("reset", () => {
        setRecords([]);
        saveStoredReviews([]);
      });

      es.onerror = () => {
        setSseState("polling");
        if (!pollTimerRef.current) {
          pollTimerRef.current = setInterval(() => {
            fetch("/api/stream/history?limit=40")
              .then((r) => (r.ok ? r.json() : null))
              .then((snap) => {
                if (snap && Array.isArray(snap.records) && snap.records.length > 0) {
                  setRecords((prev) => mergeRecords(snap.records, prev));
                }
              })
              .catch(() => {});
          }, 5000);
        }
      };
    } catch {
      setSseState("polling");
    }

    return () => {
      if (es) es.close();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveStoredReviews(records);
  }, [records, hydrated]);

  function handleToggleTheme() {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      document.documentElement.classList.toggle("dark", next === "dark");
      window.localStorage.setItem(THEME_KEY, next);
      return next;
    });
  }

  async function handleSeedDemo() {
    setSeeding(true);
    try {
      const res = await fetch("/api/stream/simulate?scenario=normal&count=10", {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.records)) {
          addBatchRecords(data.records);
        }
      }
    } catch {
      // ignore if offline
    } finally {
      setSeeding(false);
    }
  }

  async function handleClearHistory() {
    setRecords([]);
    saveStoredReviews([]);
    try {
      await fetch("/api/stream/reset", { method: "POST" });
    } catch {
      // ignore if offline
    }
  }

  function handleExportCsv() {
    const csv = exportReviewsToCsv(records);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trustguard-reviews-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleModerate(reviewId: string, status: ModerationStatus) {
    setRecords((prev) =>
      prev.map((r) =>
        r.id === reviewId
          ? {
              ...r,
              prediction: {
                ...r.prediction,
                moderation_status: status,
                analyst_reviewed: true,
              },
            }
          : r
      )
    );
    setInspectedRecord((curr) =>
      curr && curr.id === reviewId
        ? {
            ...curr,
            prediction: {
              ...curr.prediction,
              moderation_status: status,
              analyst_reviewed: true,
            },
          }
        : curr
    );

    try {
      await fetch(`/api/moderation/${encodeURIComponent(reviewId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moderation_status: status }),
      });
    } catch {
      // Local state still persists if review was only in localStorage
    }
  }

  const flaggedOrQuarantinedCount = useMemo(
    () =>
      records.filter(
        (r) =>
          r.prediction.moderation_status === "AUTO_QUARANTINED" ||
          r.prediction.moderation_status === "FLAGGED_FOR_REVIEW"
      ).length,
    [records]
  );

  const tabs: Array<{ id: ActiveTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: "overview", label: "Command Overview", icon: <BarChart3 className="h-4 w-4" aria-hidden="true" /> },
    { id: "inspector", label: "Live Inspector", icon: <SearchCode className="h-4 w-4" aria-hidden="true" /> },
    { id: "stream", label: "Real-Time Stream & Webhook", icon: <Radio className="h-4 w-4" aria-hidden="true" /> },
    { id: "batch", label: "Batch CSV / JSON", icon: <FileSpreadsheet className="h-4 w-4" aria-hidden="true" /> },
    {
      id: "moderation",
      label: "Moderation Queue",
      icon: <ShieldBan className="h-4 w-4" aria-hidden="true" />,
      badge: flaggedOrQuarantinedCount,
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Header
        theme={theme}
        onToggleTheme={handleToggleTheme}
        health={health}
        sseState={sseState}
        totalScanned={records.length}
        onExportCsv={handleExportCsv}
        onClearHistory={handleClearHistory}
      />

      <div className="border-b border-slate-200/80 bg-white/70 dark:border-slate-800/80 dark:bg-slate-900/40">
        <nav
          aria-label="Workspace sections"
          className="mx-auto flex max-w-7xl gap-1.5 overflow-x-auto px-4 py-2.5 sm:px-6 lg:px-8"
        >
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition ${
                  active
                    ? "bg-indigo-600 text-white shadow-sm shadow-indigo-500/25"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
                {typeof tab.badge === "number" && tab.badge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                      active
                        ? "bg-white/20 text-white"
                        : "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === "overview" && (
          <>
            <AnalyticsDashboard
              records={records}
              onSeedDemo={handleSeedDemo}
              seeding={seeding}
            />
            <ReviewAnalyzer onNewResult={addRecord} />
          </>
        )}

        {activeTab === "inspector" && <ReviewAnalyzer onNewResult={addRecord} />}

        {activeTab === "stream" && (
          <LiveStreamMonitor
            records={records}
            sseState={sseState}
            onInspect={setInspectedRecord}
            onFallbackRecord={addRecord}
          />
        )}

        {activeTab === "batch" && (
          <BatchScanner onBatchComplete={addBatchRecords} onInspect={setInspectedRecord} />
        )}

        {activeTab === "moderation" && (
          <ModerationQueue
            records={records}
            onInspect={setInspectedRecord}
            onModerate={handleModerate}
          />
        )}
      </main>

      <ReviewDetailDialog
        record={inspectedRecord}
        onClose={() => setInspectedRecord(null)}
        onModerate={handleModerate}
      />

      <footer className="border-t border-slate-200/80 py-6 text-center text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
        TrustGuard AI &bull; Real-Time Fake Review Detection System &bull; FastAPI SSE + TF-IDF &amp;
        16 Behavioral Signals + Next.js 14
      </footer>
    </div>
  );
}
