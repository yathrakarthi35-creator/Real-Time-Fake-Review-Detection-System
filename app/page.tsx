"use client";

import React, { useEffect, useMemo, useState } from "react";
import Header from "@/components/Header";
import ReviewAnalyzer from "@/components/ReviewAnalyzer";
import LiveStreamSimulator from "@/components/LiveStreamSimulator";
import AnalyticsDashboard from "@/components/AnalyticsDashboard";
import {
  loadStoredReviews,
  saveStoredReviews,
  THEME_KEY,
  type HealthStatus,
  type ScannedReviewRecord,
} from "@/lib/types";

export default function HomePage() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [records, setRecords] = useState<ScannedReviewRecord[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate theme + localStorage history on client mount
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
      .catch(() => {
        setHealth(null);
      });
  }, []);

  // Persist records to localStorage whenever updated
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

  function handleAddRecord(record: ScannedReviewRecord) {
    setRecords((prev) => [record, ...prev].slice(0, 250));
  }

  function handleClearHistory() {
    setRecords([]);
    saveStoredReviews([]);
  }

  const streamRecords = useMemo(
    () => records.filter((r) => r.source === "stream"),
    [records]
  );

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Header
        theme={theme}
        onToggleTheme={handleToggleTheme}
        health={health}
        totalScanned={records.length}
        onClearHistory={handleClearHistory}
      />

      <main className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
        {/* Live Analytics KPIs + Charts */}
        <AnalyticsDashboard records={records} />

        {/* Real-Time Review Analyzer */}
        <ReviewAnalyzer onNewResult={handleAddRecord} />

        {/* Live E-Commerce Stream Simulator */}
        <LiveStreamSimulator
          streamRecords={streamRecords}
          onIncomingReview={handleAddRecord}
        />
      </main>

      <footer className="border-t border-slate-200/80 py-6 text-center text-xs text-slate-500 dark:border-slate-800/80 dark:text-slate-400">
        Real-Time Fake Review Detection System &bull; Next.js 14 App Router + FastAPI Serverless +
        Scikit-learn
      </footer>
    </div>
  );
}
