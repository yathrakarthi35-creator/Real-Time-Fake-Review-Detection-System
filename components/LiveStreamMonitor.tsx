"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import {
  AlertOctagon,
  BadgeCheck,
  Copy,
  Eye,
  Flame,
  Pause,
  Play,
  Radio,
  Send,
  ShieldAlert,
  ShieldCheck,
  Star,
  Terminal,
} from "lucide-react";
import type { ScannedReviewRecord, SimulationScenario } from "@/lib/types";

interface LiveStreamMonitorProps {
  records: ScannedReviewRecord[];
  sseState: "connected" | "polling" | "connecting";
  onInspect: (record: ScannedReviewRecord) => void;
  onFallbackRecord: (record: ScannedReviewRecord) => void;
}

const SCENARIOS: Array<{ value: SimulationScenario; label: string; desc: string }> = [
  { value: "normal", label: "Normal Storefront Traffic", desc: "~65% genuine, ~35% mixed fraud" },
  { value: "hype_burst", label: "5-Star Bot Burst", desc: "High-velocity loud spam attack" },
  { value: "ai_astroturf", label: "Subtle AI Astroturfing", desc: "Polished LLM clichés, no specifics" },
  { value: "competitor_sabotage", label: "1-Star Competitor Sabotage", desc: "Coordinated negative brigading" },
  { value: "duplicate_botnet", label: "Duplicate Copy-Paste Botnet", desc: "Near-identical template campaign" },
];

export default function LiveStreamMonitor({
  records,
  sseState,
  onInspect,
  onFallbackRecord,
}: LiveStreamMonitorProps) {
  const webhookHeadingId = useId();
  const [isStreaming, setIsStreaming] = useState(false);
  const [scenario, setScenario] = useState<SimulationScenario>("normal");
  const [intervalMs, setIntervalMs] = useState<number>(1500);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Webhook Playground state
  const [whProduct, setWhProduct] = useState("AeroPods Pro ANC Earbuds");
  const [whReviewer, setWhReviewer] = useState("CheckoutWebhook_User");
  const [whRating, setWhRating] = useState(5);
  const [whVerified, setWhVerified] = useState(false);
  const [whText, setWhText] = useState(
    "Absolutely unmatched quality! Exceeded my expectations in every possible way! Cannot recommend enough!"
  );
  const [whSending, setWhSending] = useState(false);
  const [whStatus, setWhStatus] = useState<string | null>(null);
  const [copiedCurl, setCopiedCurl] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const streamRecords = records.filter(
    (r) => r.source === "stream" || r.source === "webhook" || r.source === "manual"
  );
  const recentWindow = streamRecords.slice(0, 5);
  const recentFakeCount = recentWindow.filter((r) => r.prediction.is_fake).length;
  const burstAlertActive = recentWindow.length >= 3 && recentFakeCount >= 3;

  async function triggerOneSimulatedReview(activeScenario: SimulationScenario) {
    try {
      const res = await fetch(`/api/stream/simulate?scenario=${activeScenario}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Stream API error (${res.status})`);
      const item: ScannedReviewRecord = await res.json();
      setStreamError(null);
      if (sseState !== "connected") {
        onFallbackRecord(item);
      }
    } catch (err) {
      setStreamError(err instanceof Error ? err.message : "Failed to emit stream review");
    }
  }

  useEffect(() => {
    if (!isStreaming) {
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }

    triggerOneSimulatedReview(scenario);
    timerRef.current = setInterval(() => {
      triggerOneSimulatedReview(scenario);
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming, scenario, intervalMs]);

  async function handleSendWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (whText.trim().length < 2) return;
    setWhSending(true);
    setWhStatus(null);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_name: whProduct.trim() || "Custom Product",
          reviewer: whReviewer.trim() || "Webhook Client",
          rating: whRating,
          verified_purchase: whVerified,
          text: whText.trim(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const item: ScannedReviewRecord = await res.json();
      if (sseState !== "connected") {
        onFallbackRecord(item);
      }
      setWhStatus(
        `Ingested ${item.id} -> ${item.prediction.verdict} (${item.prediction.fake_probability}% fake, ${item.prediction.latency_ms}ms)`
      );
    } catch (err) {
      setWhStatus(err instanceof Error ? err.message : "Webhook ingest failed");
    } finally {
      setWhSending(false);
    }
  }

  const samplePowershellCmd = `Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/ingest" -Method Post -ContentType "application/json" -Body '{"product_name":"AeroPods Pro ANC Earbuds","reviewer":"LiveWebhook","rating":5,"verified_purchase":false,"text":"BEST EARBUDS EVER!!! 100% RECOMMEND!!"}'`;

  return (
    <div className="space-y-6">
      {/* Live Stream Controls + Feed */}
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
              <Radio className={`h-5 w-5 ${isStreaming ? "animate-pulse" : ""}`} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-white">
                Real-Time SSE Review Stream
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pushes classified events over Server-Sent Events with sliding-window duplicate &amp; burst detection.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div>
              <label htmlFor="stream-scenario" className="sr-only">
                Traffic simulation scenario
              </label>
              <select
                id="stream-scenario"
                name="scenario"
                value={scenario}
                onChange={(e) => setScenario(e.target.value as SimulationScenario)}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {SCENARIOS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="stream-speed" className="sr-only">
                Stream cadence
              </label>
              <select
                id="stream-speed"
                name="speed"
                value={intervalMs}
                onChange={(e) => setIntervalMs(Number(e.target.value))}
                className="min-h-[38px] rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <option value={750}>Fast (750ms)</option>
                <option value={1500}>Normal (1.5s)</option>
                <option value={3000}>Slow (3.0s)</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => setIsStreaming((s) => !s)}
              className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold text-white shadow-sm transition ${
                isStreaming
                  ? "bg-amber-600 hover:bg-amber-500"
                  : "bg-indigo-600 hover:bg-indigo-500"
              }`}
            >
              {isStreaming ? (
                <>
                  <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                  Pause Stream
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" aria-hidden="true" />
                  Start Live Stream
                </>
              )}
            </button>
          </div>
        </div>

        {burstAlertActive && (
          <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-rose-900 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-100"
          >
            <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
                <Flame className="h-3.5 w-3.5" aria-hidden="true" />
                Coordinated Fake Review Burst Detected
              </div>
              <p className="mt-0.5 text-xs opacity-90">
                {recentFakeCount} of the latest {recentWindow.length} incoming reviews were flagged as{" "}
                <strong>FAKE / DECEPTIVE</strong>. Auto-quarantine rules are actively isolating high-risk submissions.
              </p>
            </div>
          </div>
        )}

        {streamError && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
          >
            {streamError}
          </div>
        )}

        {streamRecords.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center dark:border-slate-800">
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
              Live SSE Stream Ready
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Click <strong>Start Live Stream</strong> or send a real HTTP event to{" "}
              <code>POST /api/ingest</code> below.
            </p>
          </div>
        ) : (
          <div className="stream-feed-region max-h-[430px] space-y-2.5 overflow-y-auto pr-1">
            {streamRecords.slice(0, 40).map((item) => {
              const isFake = item.prediction.is_fake;
              return (
                <article
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
                          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                        ) : (
                          <ShieldCheck className="h-3 w-3" aria-hidden="true" />
                        )}
                        {item.prediction.verdict}
                      </span>
                      <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {item.source}
                      </span>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-100">
                        {item.product_name}
                      </span>
                      <span className="text-[11px] text-slate-400">by {item.reviewer}</span>
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="inline-flex items-center gap-0.5 font-medium text-amber-500">
                        {item.rating}
                        <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                      </span>
                      {item.verified_purchase ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                          Verified
                        </span>
                      ) : (
                        <span className="text-rose-500">Unverified</span>
                      )}
                      <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {item.prediction.fake_probability.toFixed(0)}% fake
                      </span>
                      <span className="hidden tabular-nums sm:inline">
                        {item.prediction.latency_ms}ms
                      </span>
                      <button
                        type="button"
                        onClick={() => onInspect(item)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                      >
                        <Eye className="h-3 w-3" aria-hidden="true" />
                        Inspect
                      </button>
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
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Live Webhook Ingestion Playground */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Terminal className="h-4 w-4 text-indigo-500" aria-hidden="true" />
            <div>
              <h2 id={webhookHeadingId} className="text-sm font-semibold text-slate-900 dark:text-white">
                Real-Time Webhook Ingestion Endpoint (POST /api/ingest)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Connect your e-commerce checkout or send a live test payload below to watch SSE broadcast instantaneously.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              navigator.clipboard?.writeText(samplePowershellCmd);
              setCopiedCurl(true);
              setTimeout(() => setCopiedCurl(false), 2000);
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {copiedCurl ? "Copied PowerShell cmd!" : "Copy PowerShell Webhook"}
          </button>
        </div>

        <form aria-labelledby={webhookHeadingId} onSubmit={handleSendWebhook} className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-3">
            <label htmlFor="wh-product" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Product
            </label>
            <input
              id="wh-product"
              name="whProduct"
              type="text"
              value={whProduct}
              onChange={(e) => setWhProduct(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="wh-reviewer" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Reviewer
            </label>
            <input
              id="wh-reviewer"
              name="whReviewer"
              type="text"
              value={whReviewer}
              onChange={(e) => setWhReviewer(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div className="md:col-span-2">
            <label htmlFor="wh-rating" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Rating
            </label>
            <select
              id="wh-rating"
              name="whRating"
              value={whRating}
              onChange={(e) => setWhRating(Number(e.target.value))}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            >
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n} Stars
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end pb-2 md:col-span-2">
            <label htmlFor="wh-verified" className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200">
              <input
                id="wh-verified"
                name="whVerified"
                type="checkbox"
                checked={whVerified}
                onChange={(e) => setWhVerified(e.target.checked)}
                className="h-4 w-4 rounded accent-indigo-600"
              />
              Verified
            </label>
          </div>

          <div className="md:col-span-3 flex items-end">
            <button
              type="submit"
              disabled={whSending}
              className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              {whSending ? "Sending..." : "Fire Webhook Event"}
            </button>
          </div>

          <div className="md:col-span-12">
            <label htmlFor="wh-text" className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
              Payload Review Text
            </label>
            <input
              id="wh-text"
              name="whText"
              type="text"
              required
              minLength={2}
              value={whText}
              onChange={(e) => setWhText(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </form>

        {whStatus && (
          <p role="status" className="mt-3 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            {whStatus}
          </p>
        )}
      </section>
    </div>
  );
}
