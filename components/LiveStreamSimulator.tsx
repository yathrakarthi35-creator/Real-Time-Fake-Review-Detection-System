"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  AlertOctagon,
  BadgeCheck,
  Flame,
  Pause,
  Play,
  Radio,
  ShieldAlert,
  ShieldCheck,
  Star,
} from "lucide-react";
import type { ScannedReviewRecord } from "@/lib/types";

interface LiveStreamSimulatorProps {
  streamRecords: ScannedReviewRecord[];
  onIncomingReview: (record: ScannedReviewRecord) => void;
}

export default function LiveStreamSimulator({
  streamRecords,
  onIncomingReview,
}: LiveStreamSimulatorProps) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [burstMode, setBurstMode] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Detect fake burst: >= 3 fake reviews within the latest 5 streamed reviews
  const recentWindow = streamRecords.slice(0, 5);
  const recentFakeCount = recentWindow.filter((r) => r.prediction.is_fake).length;
  const burstAlertActive = recentWindow.length >= 3 && recentFakeCount >= 3;

  async function fetchOneStreamItem(forceBurst: boolean) {
    try {
      const res = await fetch(`/api/sample-stream?burst=${forceBurst ? "true" : "false"}`);
      if (!res.ok) throw new Error(`Stream API error (${res.status})`);
      const item = await res.json();
      setStreamError(null);
      onIncomingReview({
        id: item.id,
        timestamp: item.timestamp,
        source: "stream",
        product_name: item.product_name,
        reviewer: item.reviewer,
        text: item.text,
        rating: item.rating,
        verified_purchase: item.verified_purchase,
        prediction: item.prediction,
      });
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Failed to fetch live stream");
    }
  }

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    // Immediate first tick so the user sees instant feedback
    fetchOneStreamItem(burstMode);
    timerRef.current = setInterval(() => {
      fetchOneStreamItem(burstMode);
    }, 2000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, burstMode]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-xl ${
              isStreaming
                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
                : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
            }`}
          >
            <Radio className={`h-5 w-5 ${isStreaming ? "animate-pulse" : ""}`} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Live E-Commerce Stream Simulator
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Classifies incoming product reviews every 2 seconds and flags coordinated fake bursts.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setBurstMode((b) => !b)}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition ${
              burstMode
                ? "border-rose-400 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-950/60 dark:text-rose-300"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            {burstMode ? "Fake Burst Mode: ON" : "Simulate Fake Burst"}
          </button>

          <button
            type="button"
            onClick={() => setIsStreaming((s) => !s)}
            className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm transition ${
              isStreaming
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-indigo-600 hover:bg-indigo-500"
            }`}
          >
            {isStreaming ? (
              <>
                <Pause className="h-3.5 w-3.5" />
                Pause Live Stream
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Start Live Stream
              </>
            )}
          </button>
        </div>
      </div>

      {/* Automatic Fake Burst Alert Banner */}
      {burstAlertActive && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-100">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          <div>
            <div className="text-xs font-bold uppercase tracking-wider">
              Coordinated Fake Review Burst Detected
            </div>
            <p className="mt-0.5 text-xs opacity-90">
              {recentFakeCount} of the last {recentWindow.length} incoming reviews were classified
              as <strong>FAKE / DECEPTIVE</strong>. Auto-quarantine recommended for unverified
              extreme ratings.
            </p>
          </div>
        </div>
      )}

      {streamError && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300">
          {streamError}
        </div>
      )}

      {/* Feed List */}
      {streamRecords.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-800">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Stream is idle
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Click <strong>Start Live Stream</strong> to begin ingesting real-time e-commerce
            reviews every 2 seconds.
          </p>
        </div>
      ) : (
        <div className="max-h-[420px] space-y-2.5 overflow-y-auto pr-1">
          {streamRecords.slice(0, 25).map((item) => {
            const isFake = item.prediction.is_fake;
            return (
              <div
                key={item.id}
                className={`rounded-xl border p-3.5 transition ${
                  isFake
                    ? "border-rose-200/90 bg-rose-50/40 dark:border-rose-900/50 dark:bg-rose-950/20"
                    : "border-slate-200/90 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-950/40"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        isFake
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}
                    >
                      {isFake ? (
                        <ShieldAlert className="h-3 w-3" />
                      ) : (
                        <ShieldCheck className="h-3 w-3" />
                      )}
                      {item.prediction.verdict}
                    </span>
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {item.product_name}
                    </span>
                    <span className="text-[11px] text-slate-400">by {item.reviewer}</span>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <span className="inline-flex items-center gap-0.5 font-medium text-amber-500">
                      {item.rating}
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    </span>
                    {item.verified_purchase ? (
                      <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                        <BadgeCheck className="h-3 w-3" />
                        Verified
                      </span>
                    ) : (
                      <span className="text-rose-500">Unverified</span>
                    )}
                    <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {item.prediction.confidence.toFixed(0)}% conf
                    </span>
                    <span className="hidden tabular-nums sm:inline">
                      {item.prediction.latency_ms}ms
                    </span>
                  </div>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {item.text}
                </p>

                {item.prediction.red_flags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.prediction.red_flags.map((flag) => (
                      <span
                        key={flag.code}
                        className="rounded-md bg-rose-100/80 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/70 dark:text-rose-300"
                      >
                        {flag.title}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
