"use client";

import React, { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Gauge, ShieldAlert, ScanSearch } from "lucide-react";
import type { ScannedReviewRecord } from "@/lib/types";

interface AnalyticsDashboardProps {
  records: ScannedReviewRecord[];
}

export default function AnalyticsDashboard({ records }: AnalyticsDashboardProps) {
  const stats = useMemo(() => {
    const total = records.length;
    if (total === 0) {
      return {
        total: 0,
        fakeCount: 0,
        genuineCount: 0,
        fakeRate: 0,
        avgConfidence: 0,
        avgLatency: 0,
      };
    }
    const fakeCount = records.filter((r) => r.prediction.is_fake).length;
    const genuineCount = total - fakeCount;
    const avgConfidence =
      records.reduce((acc, r) => acc + r.prediction.confidence, 0) / total;
    const avgLatency =
      records.reduce((acc, r) => acc + r.prediction.latency_ms, 0) / total;

    return {
      total,
      fakeCount,
      genuineCount,
      fakeRate: (fakeCount / total) * 100,
      avgConfidence,
      avgLatency,
    };
  }, [records]);

  const pieData = useMemo(
    () => [
      { name: "Genuine", value: stats.genuineCount, color: "#10b981" },
      { name: "Fake / Deceptive", value: stats.fakeCount, color: "#f43f5e" },
    ],
    [stats.genuineCount, stats.fakeCount]
  );

  const ratingBarData = useMemo(() => {
    const buckets = [1, 2, 3, 4, 5].map((star) => ({
      rating: `${star}★`,
      Genuine: 0,
      Fake: 0,
    }));
    for (const r of records) {
      const idx = Math.max(0, Math.min(4, r.rating - 1));
      if (r.prediction.is_fake) buckets[idx].Fake += 1;
      else buckets[idx].Genuine += 1;
    }
    return buckets;
  }, [records]);

  return (
    <section className="space-y-5">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total Scanned</span>
            <ScanSearch className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.total}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Saved in browser session</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Fake Detected %</span>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
            {stats.fakeRate.toFixed(1)}%
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            {stats.fakeCount} fake / {stats.genuineCount} genuine
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Avg Confidence</span>
            <Gauge className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.avgConfidence.toFixed(1)}%
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Mean classifier certainty</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Avg Inference</span>
            <Activity className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.avgLatency.toFixed(1)} ms
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Target &lt; 100ms serverless</p>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-5">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Fake vs. Genuine Split
          </h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Real-time proportion across manual checks and live stream
          </p>
          {stats.total === 0 ? (
            <div className="flex h-60 items-center justify-center text-xs text-slate-400">
              Analyze a review or start the live stream to populate charts.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={56}
                    outerRadius={86}
                    paddingAngle={4}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={28} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-7">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
            Verdicts by Star Rating (1★ – 5★)
          </h3>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Deceptive campaigns cluster heavily around extreme 1-star and 5-star ratings
          </p>
          {stats.total === 0 ? (
            <div className="flex h-60 items-center justify-center text-xs text-slate-400">
              No rating distribution data yet.
            </div>
          ) : (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingBarData} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="rating" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Genuine" fill="#10b981" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="Fake" fill="#f43f5e" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
