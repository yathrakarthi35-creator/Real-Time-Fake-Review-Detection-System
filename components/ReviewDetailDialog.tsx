"use client";

import React, { useEffect, useRef } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ShieldAlert,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";
import type { ModerationStatus, ScannedReviewRecord } from "@/lib/types";

interface ReviewDetailDialogProps {
  record: ScannedReviewRecord | null;
  onClose: () => void;
  onModerate: (reviewId: string, status: ModerationStatus) => void;
}

const METRIC_LABELS: Array<{ key: string; label: string; max: number; invert?: boolean }> = [
  { key: "generic_praise_density", label: "Hype / Sabotage Density", max: 2.0 },
  { key: "ai_template_score", label: "AI / Template Phrasing", max: 1.5 },
  { key: "exclamation_ratio", label: "Exclamation Intensity", max: 2.0 },
  { key: "caps_ratio", label: "Uppercase Shouting", max: 1.0 },
  { key: "rating_sentiment_mismatch", label: "Rating–Tone Mismatch", max: 2.0 },
  { key: "account_risk_score", label: "Account Risk Score", max: 1.0 },
  { key: "specificity_score", label: "Concrete Specificity (Genuine)", max: 2.0, invert: true },
  { key: "first_person_grounding", label: "Personal Usage Grounding (Genuine)", max: 2.0, invert: true },
];

export default function ReviewDetailDialog({
  record,
  onClose,
  onModerate,
}: ReviewDetailDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (record && !dlg.open) {
      dlg.showModal();
    } else if (!record && dlg.open) {
      dlg.close();
    }
  }, [record]);

  if (!record) {
    return (
      <dialog
        ref={dialogRef}
        onCancel={onClose}
        className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      />
    );
  }

  const p = record.prediction;

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      aria-labelledby="forensic-dialog-title"
      className="w-[calc(100%-2rem)] max-w-2xl rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
    >
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl ${
              p.is_fake
                ? "bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400"
                : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400"
            }`}
          >
            {p.is_fake ? (
              <ShieldAlert className="h-5 w-5" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            )}
          </div>
          <div>
            <h2 id="forensic-dialog-title" className="text-base font-bold">
              Forensic Review Inspection
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {record.product_name} &bull; {record.reviewer} &bull;{" "}
              {new Date(record.timestamp).toLocaleTimeString()}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Close inspection dialog"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="max-h-[75vh] space-y-5 overflow-y-auto p-5">
        {/* Verdict & Metadata Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                p.is_fake
                  ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                  : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
              }`}
            >
              {p.verdict}
            </span>
            <span className="rounded-full bg-slate-200/80 px-2.5 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {p.moderation_status}
            </span>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
              {record.rating}
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
            </span>
            {record.verified_purchase ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Verified
              </span>
            ) : (
              <span className="text-xs font-medium text-rose-500">Unverified</span>
            )}
          </div>

          <div className="text-right text-xs">
            <span className="font-bold tabular-nums">{p.fake_probability.toFixed(1)}%</span> fake
            prob &bull; <span className="tabular-nums">{p.latency_ms} ms</span>
          </div>
        </div>

        {/* Review Text */}
        <div>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Submitted Content
          </h3>
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm leading-relaxed dark:border-slate-800 dark:bg-slate-950">
            {record.text}
          </p>
        </div>

        {/* Behavioral Feature Bars */}
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            Behavioral &amp; NLP Signal Telemetry
          </h3>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {METRIC_LABELS.map((item) => {
              const raw = p.behavioral_metrics[item.key] ?? 0;
              const pct = Math.min(100, Math.max(2, (raw / item.max) * 100));
              return (
                <div
                  key={item.key}
                  className="rounded-lg border border-slate-200/80 p-2.5 dark:border-slate-800"
                >
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {item.label}
                    </span>
                    <span className="tabular-nums text-slate-500">{raw.toFixed(2)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div
                      className={`h-full rounded-full ${
                        item.invert ? "bg-emerald-500" : "bg-rose-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Flags */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
              Red Flags ({p.red_flags.length})
            </h3>
            {p.red_flags.length === 0 ? (
              <p className="text-xs text-slate-400">None detected.</p>
            ) : (
              p.red_flags.map((rf) => (
                <div
                  key={rf.code}
                  className="rounded-lg border border-rose-200 bg-rose-50/70 p-2 text-xs dark:border-rose-900/50 dark:bg-rose-950/30"
                >
                  <div className="font-semibold text-rose-800 dark:text-rose-200">{rf.title}</div>
                  <p className="mt-0.5 text-[11px] text-rose-700/90 dark:text-rose-300/80">
                    {rf.detail}
                  </p>
                </div>
              ))
            )}
          </div>

          <div className="space-y-1.5">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
              Authenticity Cues ({p.green_flags.length})
            </h3>
            {p.green_flags.length === 0 ? (
              <p className="text-xs text-slate-400">None detected.</p>
            ) : (
              p.green_flags.map((gf) => (
                <div
                  key={gf.code}
                  className="rounded-lg border border-emerald-200 bg-emerald-50/70 p-2 text-xs dark:border-emerald-900/50 dark:bg-emerald-950/30"
                >
                  <div className="font-semibold text-emerald-800 dark:text-emerald-200">
                    {gf.title}
                  </div>
                  <p className="mt-0.5 text-[11px] text-emerald-700/90 dark:text-emerald-300/80">
                    {gf.detail}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Analyst Override Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/70 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950/60">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Analyst Moderation Action:
        </span>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onModerate(record.id, "APPROVED")}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
          >
            Approve Genuine
          </button>
          <button
            type="button"
            onClick={() => onModerate(record.id, "FLAGGED_FOR_REVIEW")}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
          >
            Hold for Review
          </button>
          <button
            type="button"
            onClick={() => onModerate(record.id, "AUTO_QUARANTINED")}
            className="rounded-lg border border-rose-300 bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 dark:border-rose-800"
          >
            Quarantine Review
          </button>
        </div>
      </div>
    </dialog>
  );
}
