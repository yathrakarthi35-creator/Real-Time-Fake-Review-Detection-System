"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Loader2,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import type { PredictionResponse, ScannedReviewRecord, TriggerWord } from "@/lib/types";

interface ReviewAnalyzerProps {
  onNewResult: (record: ScannedReviewRecord) => void;
}

const PRESETS = [
  {
    label: "5-Star Hype Bot",
    rating: 5,
    verified: false,
    product: "AeroPods Pro ANC Earbuds",
    reviewer: "DealHunter992",
    ageDays: 3,
    reviewCount: 1,
    text: "BEST EARBUDS EVER!!! 100% RECOMMEND!! Literally changed my life!! Zero flaws, absolute perfection! BUY THIS RIGHT NOW, you won't regret it!! 5 STARS!!!",
  },
  {
    label: "Subtle AI Astroturf",
    rating: 5,
    verified: false,
    product: "PureAir HEPA-13 Purifier",
    reviewer: "Clara_B91",
    ageDays: 8,
    reviewCount: 22,
    text: "This air purifier truly exceeded my expectations in every possible way. The craftsmanship is unmatched and it seamlessly integrates into a busy lifestyle. Cannot recommend enough.",
  },
  {
    label: "Genuine Detailed Review",
    rating: 4,
    verified: true,
    product: "BrewMaster Drip Coffee Maker",
    reviewer: "Daniel K.",
    ageDays: 920,
    reviewCount: 18,
    text: "I have been using this coffee maker for 6 weeks every morning. Brews a full 10-cup carafe in about 7 minutes and keeps it hot for 2 hours. Minor downside is the water gauge is a bit dim, however overall great value.",
  },
  {
    label: "1-Star Competitor Sabotage",
    rating: 1,
    verified: false,
    product: "VoltCore 20000mAh Power Bank",
    reviewer: "PromoBot_44",
    ageDays: 2,
    reviewCount: 41,
    text: "TOTAL SCAM!! COMPLETE GARBAGE!! DO NOT BUY THIS!! Worst product ever made! Stay far away and run away from this fraud seller! ZERO STARS!!",
  },
];

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedReviewText({
  text,
  triggers,
}: {
  text: string;
  triggers: TriggerWord[];
}) {
  const segments = useMemo(() => {
    if (!triggers.length || !text.trim()) {
      return [{ text, impact: null as null | "fake" | "genuine" }];
    }
    const sorted = [...triggers].sort((a, b) => b.word.length - a.word.length);
    const map = new Map<string, "fake" | "genuine">();
    sorted.forEach((t) => map.set(t.word.toLowerCase(), t.impact));

    const pattern = new RegExp(`(${sorted.map((t) => escapeRegExp(t.word)).join("|")})`, "gi");
    const parts = text.split(pattern);

    return parts.map((part) => ({
      text: part,
      impact: map.get(part.toLowerCase()) ?? null,
    }));
  }, [text, triggers]);

  return (
    <p className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 text-sm leading-relaxed text-slate-800 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-200">
      {segments.map((seg, idx) => {
        if (seg.impact === "fake") {
          return (
            <mark
              key={idx}
              className="mx-0.5 rounded bg-rose-200/90 px-1 py-0.5 font-medium text-rose-950 dark:bg-rose-900/70 dark:text-rose-100"
            >
              {seg.text}
            </mark>
          );
        }
        if (seg.impact === "genuine") {
          return (
            <mark
              key={idx}
              className="mx-0.5 rounded bg-emerald-200/80 px-1 py-0.5 font-medium text-emerald-950 dark:bg-emerald-900/60 dark:text-emerald-100"
            >
              {seg.text}
            </mark>
          );
        }
        return <React.Fragment key={idx}>{seg.text}</React.Fragment>;
      })}
    </p>
  );
}

export default function ReviewAnalyzer({ onNewResult }: ReviewAnalyzerProps) {
  const headingId = useId();
  const textHelpId = useId();
  const errorId = useId();

  const [text, setText] = useState(PRESETS[1].text);
  const [productName, setProductName] = useState(PRESETS[1].product);
  const [reviewer, setReviewer] = useState(PRESETS[1].reviewer);
  const [accountAgeDays, setAccountAgeDays] = useState<string>(String(PRESETS[1].ageDays));
  const [reviewCount, setReviewCount] = useState<string>(String(PRESETS[1].reviewCount));
  const [rating, setRating] = useState<number>(PRESETS[1].rating);
  const [verifiedPurchase, setVerifiedPurchase] = useState<boolean>(PRESETS[1].verified);
  const [publishToStream, setPublishToStream] = useState<boolean>(true);
  const [liveMode, setLiveMode] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PredictionResponse | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function runAnalysis(recordToHistory: boolean) {
    const trimmed = text.trim();
    if (trimmed.length < 2) {
      setError("Please enter at least 2 characters of review text to analyze.");
      return;
    }

    const ageNum = accountAgeDays.trim() === "" ? null : Number(accountAgeDays);
    const countNum = reviewCount.trim() === "" ? null : Number(reviewCount);

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          rating,
          verified_purchase: verifiedPurchase,
          product_name: productName.trim() || "Custom Product",
          reviewer: reviewer.trim() || "Manual Inspector",
          account_age_days: Number.isFinite(ageNum) ? ageNum : null,
          reviewer_review_count: Number.isFinite(countNum) ? countNum : null,
          publish_to_stream: recordToHistory && publishToStream,
        }),
      });

      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`API error (${res.status}): ${msg}`);
      }

      const data: PredictionResponse = await res.json();
      setResult(data);

      if (recordToHistory) {
        if (data.published_record) {
          onNewResult(data.published_record);
        } else {
          onNewResult({
            id: `manual_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
            timestamp: new Date().toISOString(),
            source: "manual",
            product_name: productName.trim() || "Custom Product",
            reviewer: reviewer.trim() || "Manual Inspector",
            text: trimmed,
            rating,
            verified_purchase: verifiedPurchase,
            account_age_days: Number.isFinite(ageNum) ? ageNum : null,
            reviewer_review_count: Number.isFinite(countNum) ? countNum : null,
            prediction: data,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reach /api/predict");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!liveMode || text.trim().length < 5) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runAnalysis(false);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, rating, verifiedPurchase, accountAgeDays, reviewCount, liveMode]);

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setText(preset.text);
    setRating(preset.rating);
    setVerifiedPurchase(preset.verified);
    setProductName(preset.product);
    setReviewer(preset.reviewer);
    setAccountAgeDays(String(preset.ageDays));
    setReviewCount(String(preset.reviewCount));
    setError(null);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Input Card */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-white">
              Live Forensic Review Inspector
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Analyze text, account metadata, and cross-review duplicate signals in real time.
            </p>
          </div>
          <label
            htmlFor="live-debounce-toggle"
            className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <input
              id="live-debounce-toggle"
              name="liveDebounce"
              type="checkbox"
              checked={liveMode}
              onChange={(e) => setLiveMode(e.target.checked)}
              className="h-3.5 w-3.5 rounded accent-indigo-600"
            />
            <Zap className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            Live Debounce
          </label>
        </div>

        {/* Presets */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            Test Cases:
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-200 dark:hover:border-indigo-500/60 dark:hover:bg-indigo-950/60"
            >
              {p.label}
            </button>
          ))}
        </div>

        <form
          aria-labelledby={headingId}
          onSubmit={(e) => {
            e.preventDefault();
            runAnalysis(true);
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="inspector-product"
                className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Product Name
              </label>
              <input
                id="inspector-product"
                name="productName"
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="e.g., AeroPods Pro ANC Earbuds"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label
                htmlFor="inspector-reviewer"
                className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Reviewer Handle
              </label>
              <input
                id="inspector-reviewer"
                name="reviewer"
                type="text"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="e.g., Clara_B91"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="inspector-age"
                className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Account Age (days)
              </label>
              <input
                id="inspector-age"
                name="accountAgeDays"
                type="text"
                inputMode="numeric"
                value={accountAgeDays}
                onChange={(e) => setAccountAgeDays(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="e.g., 12"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label
                htmlFor="inspector-rev-count"
                className="mb-1 block text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Reviewer Total Reviews
              </label>
              <input
                id="inspector-rev-count"
                name="reviewerReviewCount"
                type="text"
                inputMode="numeric"
                value={reviewCount}
                onChange={(e) => setReviewCount(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="e.g., 25"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <label
                htmlFor="inspector-text"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Review Text
              </label>
              <span id={textHelpId} className="text-[11px] text-slate-400">
                {text.length} / 5000 chars (min 2)
              </span>
            </div>
            <textarea
              id="inspector-text"
              name="reviewText"
              required
              minLength={2}
              maxLength={5000}
              rows={4}
              aria-describedby={error ? `${textHelpId} ${errorId}` : textHelpId}
              aria-invalid={error ? "true" : undefined}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (error && e.target.value.trim().length >= 2) setError(null);
              }}
              placeholder="Paste customer review text here..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* Accessible Star Rating Radio Group */}
            <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <legend className="px-1 text-xs font-medium text-slate-600 dark:text-slate-300">
                Star Rating ({rating} / 5)
              </legend>
              <div className="mt-1 flex items-center gap-2">
                {[1, 2, 3, 4, 5].map((star) => (
                  <label
                    key={star}
                    className={`inline-flex min-h-[32px] min-w-[32px] cursor-pointer items-center justify-center rounded-lg border text-xs font-bold transition ${
                      rating === star
                        ? "border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-500 dark:bg-amber-950/60 dark:text-amber-300"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400"
                    }`}
                  >
                    <input
                      type="radio"
                      name="starRating"
                      value={star}
                      checked={rating === star}
                      onChange={() => setRating(star)}
                      className="sr-only"
                    />
                    {star}★
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Verified Purchase Toggle */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/60">
              <div>
                <span className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
                  <BadgeCheck
                    className={`h-4 w-4 ${
                      verifiedPurchase ? "text-emerald-500" : "text-slate-400"
                    }`}
                    aria-hidden="true"
                  />
                  Verified Purchase
                </span>
                <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                  {verifiedPurchase ? "Order confirmed" : "Unverified account"}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={verifiedPurchase}
                aria-label="Verified purchase status"
                onClick={() => setVerifiedPurchase((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  verifiedPurchase ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-700"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    verifiedPurchase ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="publish-stream-check"
              name="publishToStream"
              type="checkbox"
              checked={publishToStream}
              onChange={(e) => setPublishToStream(e.target.checked)}
              className="h-4 w-4 rounded accent-indigo-600"
            />
            <label
              htmlFor="publish-stream-check"
              className="text-xs text-slate-600 dark:text-slate-300"
            >
              Broadcast analyzed review to Live SSE Stream &amp; Moderation Queue
            </label>
          </div>

          {error && (
            <div
              id={errorId}
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/50 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-indigo-500/25 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Running ML + Stream Forensic Scan...
              </>
            ) : (
              <>
                <Search className="h-4 w-4" aria-hidden="true" />
                Analyze &amp; Log to Platform
              </>
            )}
          </button>
        </form>
      </section>

      {/* Forensic Results Card */}
      <section
        aria-live="polite"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70 lg:col-span-6"
      >
        {!result ? (
          <div className="flex h-full min-h-[380px] flex-col items-center justify-center text-center">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
              <Sparkles className="h-6 w-6" aria-hidden="true" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
              Ready for Real-Time Forensic Inspection
            </h3>
            <p className="mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">
              Submit a review or enable <strong>Live Debounce</strong> to inspect TF-IDF weights,
              AI-astroturf signals, account risk, and automated moderation triage.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`flex h-11 w-11 items-center justify-center rounded-xl ${
                    result.is_fake
                      ? "bg-rose-100 text-rose-600 dark:bg-rose-950/80 dark:text-rose-400"
                      : "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/80 dark:text-emerald-400"
                  }`}
                >
                  {result.is_fake ? (
                    <ShieldAlert className="h-6 w-6" aria-hidden="true" />
                  ) : (
                    <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                  )}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold tracking-wide ${
                        result.is_fake
                          ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                          : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                      }`}
                    >
                      {result.verdict}
                    </span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {result.moderation_status}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {result.engine} &bull; {result.latency_ms} ms
                    {result.duplicate_similarity > 0
                      ? ` · ${result.duplicate_similarity}% stream similarity`
                      : ""}
                  </p>
                </div>
              </div>

              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums text-slate-900 dark:text-white">
                  {result.confidence.toFixed(1)}%
                </div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  Confidence &bull; Risk: {result.risk_level}
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
                <span>Deception Probability</span>
                <span className="tabular-nums">{result.fake_probability.toFixed(1)}%</span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    result.fake_probability >= 70
                      ? "bg-rose-500"
                      : result.fake_probability >= 45
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, Math.max(3, result.fake_probability))}%` }}
                />
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Inline Trigger Highlights
              </h3>
              <HighlightedReviewText text={text} triggers={result.trigger_words} />
              {result.trigger_words.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {result.trigger_words.map((tw) => (
                    <span
                      key={`${tw.word}-${tw.impact}`}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                        tw.impact === "fake"
                          ? "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-900"
                          : "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-900"
                      }`}
                    >
                      {tw.word}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  Red Flags ({result.red_flags.length})
                </h4>
                {result.red_flags.length === 0 ? (
                  <p className="text-xs text-slate-400">No behavioral red flags detected.</p>
                ) : (
                  result.red_flags.map((rf) => (
                    <div
                      key={rf.code}
                      className="rounded-xl border border-rose-200/80 bg-rose-50/70 p-2.5 dark:border-rose-900/50 dark:bg-rose-950/30"
                    >
                      <div className="text-xs font-semibold text-rose-800 dark:text-rose-200">
                        {rf.title}
                      </div>
                      <p className="mt-0.5 text-[11px] text-rose-700/90 dark:text-rose-300/80">
                        {rf.detail}
                      </p>
                    </div>
                  ))
                )}
              </div>

              <div className="space-y-2">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Authenticity Signals ({result.green_flags.length})
                </h4>
                {result.green_flags.length === 0 ? (
                  <p className="text-xs text-slate-400">No strong authenticity cues found.</p>
                ) : (
                  result.green_flags.map((gf) => (
                    <div
                      key={gf.code}
                      className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/30"
                    >
                      <div className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">
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

            {/* Key Behavioral Signal Bars */}
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Behavioral Feature Telemetry
              </h4>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {[
                  { key: "ai_template_score", label: "AI / Template", max: 1.5, genuine: false },
                  { key: "generic_praise_density", label: "Hype Density", max: 2.0, genuine: false },
                  { key: "account_risk_score", label: "Account Risk", max: 1.0, genuine: false },
                  { key: "rating_sentiment_mismatch", label: "Tone Mismatch", max: 2.0, genuine: false },
                  { key: "specificity_score", label: "Specificity", max: 2.0, genuine: true },
                  { key: "first_person_grounding", label: "Grounding", max: 2.0, genuine: true },
                ].map((sig) => {
                  const val = result.behavioral_metrics[sig.key] ?? 0;
                  const pct = Math.min(100, Math.max(3, (val / sig.max) * 100));
                  return (
                    <div
                      key={sig.key}
                      className="rounded-lg border border-slate-200/80 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/40"
                    >
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="font-medium text-slate-600 dark:text-slate-300">
                          {sig.label}
                        </span>
                        <span className="tabular-nums text-slate-500">{val.toFixed(2)}</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                        <div
                          className={`h-full rounded-full ${
                            sig.genuine ? "bg-emerald-500" : "bg-rose-500"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
