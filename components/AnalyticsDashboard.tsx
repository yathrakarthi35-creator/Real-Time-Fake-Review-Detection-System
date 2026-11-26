"use client";

import React, { useMemo } from "react";
import {
  Area,
  AreaChart,
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
import { Activity, AlertOctagon, Gauge, Loader2, Play, ScanSearch, ShieldAlert, ShieldBan } from "lucide-react";
import { computeProductLeaderboard, type ScannedReviewRecord } from "@/lib/types";

interface AnalyticsDashboardProps {
  records: ScannedReviewRecord[];
  onSeedDemo?: () => void;
  seeding?: boolean;
}

export default function AnalyticsDashboard({
  records,
  onSeedDemo,
  seeding = false,
}: AnalyticsDashboardProps) {
  const stats = useMemo(() => {
    const total = records.length;
    if (total === 0) {
      return {
        total: 0,
        fakeCount: 0,
        genuineCount: 0,
        quarantinedCount: 0,
        fakeRate: 0,
        avgConfidence: 0,
        avgLatency: 0,
      };
    }
    const fakeCount = records.filter((r) => r.prediction.is_fake).length;
    const quarantinedCount = records.filter(
      (r) => r.prediction.moderation_status === "AUTO_QUARANTINED"
    ).length;
    const genuineCount = total - fakeCount;
    const avgConfidence =
      records.reduce((acc, r) => acc + r.prediction.confidence, 0) / total;
    const avgLatency =
      records.reduce((acc, r) => acc + r.prediction.latency_ms, 0) / total;

    return {
      total,
      fakeCount,
      genuineCount,
      quarantinedCount,
      fakeRate: (fakeCount / total) * 100,
      avgConfidence,
      avgLatency,
    };
  }, [records]);

  const leaderboard = useMemo(() => computeProductLeaderboard(records), [records]);
  const activeAttacks = leaderboard.filter((p) => p.under_attack).length;

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

  // Bin latest 48 records chronologically into 8 rolling windows for live telemetry chart
  const timelineData = useMemo(() => {
    if (records.length === 0) return [];
    const chronological = [...records].slice(0, 48).reverse();
    const bucketSize = Math.max(1, Math.ceil(chronological.length / 8));
    const points: Array<{ slot: string; Genuine: number; Fake: number }> = [];

    for (let i = 0; i < chronological.length; i += bucketSize) {
      const slice = chronological.slice(i, i + bucketSize);
      const lastTs = new Date(slice[slice.length - 1].timestamp);
      const label = lastTs.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const fake = slice.filter((r) => r.prediction.is_fake).length;
      points.push({
        slot: label,
        Genuine: slice.length - fake,
        Fake: fake,
      });
    }
    return points;
  }, [records]);

  return (
    <section className="space-y-6" aria-label="Real-Time Telemetry Overview">
      {stats.total === 0 && onSeedDemo && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50/70 px-5 py-4 dark:border-indigo-900/60 dark:bg-indigo-950/30">
          <div>
            <h2 className="text-sm font-semibold text-indigo-950 dark:text-indigo-100">
              Live Telemetry Ready
            </h2>
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              Analyze a review below, open the SSE Stream tab, or emit 10 live simulated reviews to populate dashboards immediately.
            </p>
          </div>
          <button
            type="button"
            disabled={seeding}
            onClick={onSeedDemo}
            className="inline-flex min-h-[38px] items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            {seeding ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Streaming Events...
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                Stream 10 Live Reviews
              </>
            )}
          </button>
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Total Scanned</span>
            <ScanSearch className="h-4 w-4 text-indigo-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.total}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Live SSE + local session</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Fake Rate</span>
            <ShieldAlert className="h-4 w-4 text-rose-500" aria-hidden="true" />
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
            <span>Auto-Quarantined</span>
            <ShieldBan className="h-4 w-4 text-amber-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.quarantinedCount}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Blocked from storefront</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>SKUs Under Attack</span>
            <AlertOctagon className="h-4 w-4 text-rose-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {activeAttacks}
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Avg certainty {stats.avgConfidence.toFixed(1)}%
          </p>
        </div>

        <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-1">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
            <span>Avg Inference</span>
            <Activity className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          </div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
            {stats.avgLatency.toFixed(1)} ms
          </div>
          <p className="mt-0.5 text-[11px] text-slate-400">Real-time SLA &lt; 100ms</p>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Real-Time Ingestion Timeline
          </h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Rolling volume of genuine vs. deceptive reviews
          </p>
          {timelineData.length === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-slate-400">
              Start the live stream, send a webhook, or analyze a review to populate telemetry.
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={timelineData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="slot" fontSize={11} />
                  <YAxis allowDecimals={false} fontSize={11} />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="Genuine"
                    stackId="1"
                    stroke="#10b981"
                    fill="#10b981"
                    fillOpacity={0.35}
                  />
                  <Area
                    type="monotone"
                    dataKey="Fake"
                    stackId="1"
                    stroke="#f43f5e"
                    fill="#f43f5e"
                    fillOpacity={0.45}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Verdict Split
          </h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Cumulative integrity ratio
          </p>
          {stats.total === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-slate-400">
              No reviews scanned yet.
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={48}
                    outerRadius={76}
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

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-4">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Verdicts by Star Rating (1★–5★)
          </h2>
          <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
            Fake campaigns cluster at 1★ and 5★ extremes
          </p>
          {stats.total === 0 ? (
            <div className="flex h-56 items-center justify-center text-xs text-slate-400">
              No rating distribution data yet.
            </div>
          ) : (
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={ratingBarData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
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

      {/* Product Trust & Risk Leaderboard */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
              Product Trust &amp; Rating Distortion Leaderboard
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Compares raw star rating against Trust-Adjusted Rating (excluding deceptive reviews)
            </p>
          </div>
          <span className="inline-flex items-center gap-1 text-xs text-slate-400">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            {leaderboard.length} monitored SKUs
          </span>
        </div>

        {leaderboard.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-8 text-center text-xs text-slate-400 dark:border-slate-800">
            No product telemetry recorded yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">
                Product review fraud risk and trust-adjusted rating breakdown
              </caption>
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th scope="col" className="py-2.5 pr-4 font-semibold">Product / SKU</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Reviews</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Fake Rate</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Quarantined</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Raw Rating</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Trust-Adjusted</th>
                  <th scope="col" className="pl-3 py-2.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {leaderboard.slice(0, 8).map((row) => (
                  <tr key={row.product_name} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/40">
                    <td className="py-2.5 pr-4 font-medium text-slate-900 dark:text-slate-100">
                      {row.product_name}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{row.total_reviews}</td>
                    <td className="px-3 py-2.5 tabular-nums font-semibold text-rose-600 dark:text-rose-400">
                      {row.fake_rate.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{row.quarantined_count}</td>
                    <td className="px-3 py-2.5 tabular-nums text-slate-500">
                      {row.raw_avg_rating.toFixed(2)}★
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                      {row.trust_adjusted_rating.toFixed(2)}★
                    </td>
                    <td className="pl-3 py-2.5">
                      {row.under_attack ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                          BURST ATTACK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                          HEALTHY
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
