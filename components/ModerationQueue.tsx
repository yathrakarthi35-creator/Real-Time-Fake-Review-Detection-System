"use client";

import React, { useMemo, useState } from "react";
import { CheckCircle2, Eye, ShieldAlert, ShieldBan, ShieldCheck } from "lucide-react";
import type { ModerationStatus, ScannedReviewRecord } from "@/lib/types";

interface ModerationQueueProps {
  records: ScannedReviewRecord[];
  onInspect: (record: ScannedReviewRecord) => void;
  onModerate: (reviewId: string, status: ModerationStatus) => void;
}

export default function ModerationQueue({
  records,
  onInspect,
  onModerate,
}: ModerationQueueProps) {
  const [filterStatus, setFilterStatus] = useState<"ALL" | ModerationStatus>("ALL");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return records.filter((r) => {
      if (filterStatus !== "ALL" && r.prediction.moderation_status !== filterStatus) {
        return false;
      }
      if (!q) return true;
      return (
        r.product_name.toLowerCase().includes(q) ||
        r.reviewer.toLowerCase().includes(q) ||
        r.text.toLowerCase().includes(q)
      );
    });
  }, [records, filterStatus, query]);

  const counts = useMemo(() => {
    return {
      ALL: records.length,
      AUTO_QUARANTINED: records.filter((r) => r.prediction.moderation_status === "AUTO_QUARANTINED").length,
      FLAGGED_FOR_REVIEW: records.filter((r) => r.prediction.moderation_status === "FLAGGED_FOR_REVIEW").length,
      APPROVED: records.filter((r) => r.prediction.moderation_status === "APPROVED").length,
    };
  }, [records]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            Trust &amp; Safety Moderation Queue
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Review quarantined and flagged items, inspect behavioral triggers, or override decisions in real time.
          </p>
        </div>

        <search>
          <label htmlFor="moderation-search" className="sr-only">
            Filter moderation queue
          </label>
          <input
            id="moderation-search"
            name="moderationSearch"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search product, reviewer, text..."
            className="w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
          />
        </search>
      </div>

      {/* Filter Pills */}
      <div className="mb-4 flex flex-wrap gap-2">
        {(
          [
            { key: "ALL", label: "All Scanned" },
            { key: "AUTO_QUARANTINED", label: "Auto-Quarantined" },
            { key: "FLAGGED_FOR_REVIEW", label: "Flagged" },
            { key: "APPROVED", label: "Approved" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilterStatus(tab.key)}
            aria-pressed={filterStatus === tab.key}
            className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
              filterStatus === tab.key
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/60 dark:text-indigo-300"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            {tab.label} ({counts[tab.key]})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-xs text-slate-400 dark:border-slate-800">
          No reviews match the current moderation filter.
        </div>
      ) : (
        <div className="stream-feed-region max-h-[540px] space-y-2.5 overflow-y-auto pr-1">
          {filtered.slice(0, 60).map((item) => {
            const status = item.prediction.moderation_status;
            return (
              <article
                key={item.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5 dark:border-slate-800 dark:bg-slate-950/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        status === "AUTO_QUARANTINED"
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          : status === "FLAGGED_FOR_REVIEW"
                          ? "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}
                    >
                      {status === "AUTO_QUARANTINED" ? (
                        <ShieldBan className="h-3 w-3" aria-hidden="true" />
                      ) : status === "FLAGGED_FOR_REVIEW" ? (
                        <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                      )}
                      {status}
                    </span>

                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                      {item.product_name}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      {item.reviewer} &bull; {item.rating}★ &bull;{" "}
                      {item.prediction.fake_probability.toFixed(1)}% fake
                    </span>
                    {item.prediction.analyst_reviewed && (
                      <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Analyst Reviewed
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onInspect(item)}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      <Eye className="h-3 w-3" aria-hidden="true" />
                      Inspect
                    </button>
                    {status !== "APPROVED" && (
                      <button
                        type="button"
                        onClick={() => onModerate(item.id, "APPROVED")}
                        className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-300"
                      >
                        Approve
                      </button>
                    )}
                    {status !== "AUTO_QUARANTINED" && (
                      <button
                        type="button"
                        onClick={() => onModerate(item.id, "AUTO_QUARANTINED")}
                        className="rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/60 dark:text-rose-300"
                      >
                        Quarantine
                      </button>
                    )}
                  </div>
                </div>

                <p className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  {item.text}
                </p>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
