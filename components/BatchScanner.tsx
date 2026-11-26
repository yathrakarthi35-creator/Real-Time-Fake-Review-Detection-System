"use client";

import React, { useId, useState } from "react";
import { Download, Eye, FileSpreadsheet, Loader2, Play, Upload } from "lucide-react";
import type { BatchPredictResponse, ScannedReviewRecord } from "@/lib/types";

interface BatchScannerProps {
  onBatchComplete: (records: ScannedReviewRecord[]) => void;
  onInspect: (record: ScannedReviewRecord) => void;
}

const SAMPLE_CSV = `product_name,reviewer,rating,verified_purchase,text
AeroPods Pro ANC Earbuds,DealHunter992,5,false,"BEST EARBUDS EVER!!! 100% RECOMMEND!! Literally changed my life!! BUY NOW!!"
BrewMaster Drip Coffee Maker,Daniel K.,5,true,"Brewing takes about 6 minutes for a full 10-cup carafe and keeps coffee hot for 2 hours. Water gauge is slightly dim."
PureAir HEPA-13 Purifier,Clara_B91,5,false,"This purifier truly exceeded my expectations in every possible way. Unmatched quality and seamlessly integrates into daily life. Cannot recommend enough."
KeyForge TKL Mechanical Keyboard,Arjun S.,4,true,"Solid aluminum plate and crisp tactile switches. Shipping arrived in 2 days. Wish the USB-C cable were braided."
TrailStride Running Shoes,Anonymous_904,1,false,"TOTAL SCAM!! COMPLETE GARBAGE!! DO NOT BUY THIS!! ZERO STARS!!"
VoltCore 20000mAh Power Bank,Sneha V.,5,true,"Charged my phone three full times during a weekend train trip with 20% left. Slightly heavy, but 45W USB-C output is reliable."
ChefCraft Ceramic Frying Pan,BotNode_104,5,false,"Absolute perfection! Zero flaws! Exceeded all expectations and worth every penny! Five stars all the way!"
ChefCraft Ceramic Frying Pan,BotNode_105,5,false,"Absolute perfection! Zero flaws! Exceeded all expectations and worth every penny! Five stars all the way!"`;

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseInputToReviews(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed);
    if (!Array.isArray(arr)) throw new Error("JSON must be an array of review objects");
    return arr.map((item) => ({
      product_name: String(item.product_name || "Custom Product"),
      reviewer: String(item.reviewer || "Batch Reviewer"),
      rating: Math.max(1, Math.min(5, Number(item.rating ?? 5))),
      verified_purchase: Boolean(item.verified_purchase ?? true),
      text: String(item.text || ""),
    }));
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV requires a header row and at least one review row.");
  }
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idxText = headers.indexOf("text");
  if (idxText === -1) throw new Error('CSV must contain a "text" column.');

  const idxProd = headers.indexOf("product_name");
  const idxRev = headers.indexOf("reviewer");
  const idxRat = headers.indexOf("rating");
  const idxVer = headers.indexOf("verified_purchase");

  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line);
    const verRaw = idxVer >= 0 ? (cols[idxVer] ?? "").toLowerCase() : "true";
    return {
      product_name: idxProd >= 0 && cols[idxProd] ? cols[idxProd] : "Batch Product",
      reviewer: idxRev >= 0 && cols[idxRev] ? cols[idxRev] : "Batch Reviewer",
      rating: idxRat >= 0 && cols[idxRat] ? Math.max(1, Math.min(5, Number(cols[idxRat]) || 5)) : 5,
      verified_purchase: verRaw === "true" || verRaw === "1" || verRaw === "yes",
      text: cols[idxText] ?? "",
    };
  });
}

export default function BatchScanner({ onBatchComplete, onInspect }: BatchScannerProps) {
  const headingId = useId();
  const [rawInput, setRawInput] = useState(SAMPLE_CSV);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchPredictResponse | null>(null);
  const [mappedRecords, setMappedRecords] = useState<ScannedReviewRecord[]>([]);

  async function handleRunBatch(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const reviews = parseInputToReviews(rawInput).filter((r) => r.text.trim().length >= 2);
      if (reviews.length === 0) {
        throw new Error("No valid reviews found (each review text must be at least 2 characters).");
      }

      const res = await fetch("/api/batch-predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviews: reviews.slice(0, 200) }),
      });

      if (!res.ok) {
        throw new Error(`Batch API failed (${res.status}): ${await res.text()}`);
      }

      const data: BatchPredictResponse = await res.json();
      setBatchResult(data);

      const now = new Date().toISOString();
      const mapped: ScannedReviewRecord[] = data.results.map((item, idx) => ({
        id: `batch_${Date.now()}_${idx}`,
        timestamp: now,
        source: "batch",
        product_name: item.product_name,
        reviewer: item.reviewer,
        rating: item.rating,
        verified_purchase: item.verified_purchase,
        text: item.text,
        prediction: item.prediction,
      }));
      setMappedRecords(mapped);
      onBatchComplete(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse or scan batch");
    } finally {
      setLoading(false);
    }
  }

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setRawInput(reader.result);
        setError(null);
      }
    };
    reader.readAsText(file);
  }

  function handleDownloadBatchCsv() {
    if (!batchResult) return;
    const rows = [
      "product_name,reviewer,rating,verified_purchase,verdict,fake_probability_pct,moderation_status,duplicate_similarity_pct,text",
      ...batchResult.results.map((r) =>
        [
          r.product_name,
          r.reviewer,
          r.rating,
          r.verified_purchase,
          r.prediction.verdict,
          r.prediction.fake_probability,
          r.prediction.moderation_status,
          r.prediction.duplicate_similarity,
          `"${r.text.replace(/"/g, '""')}"`,
        ].join(",")
      ),
    ].join("\n");

    const blob = new Blob([rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fake-review-batch-audit-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <FileSpreadsheet className="h-5 w-5 text-indigo-500" aria-hidden="true" />
            <div>
              <h2 id={headingId} className="text-base font-semibold text-slate-900 dark:text-white">
                Batch CSV / JSON Review Scanner
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Scan up to 200 product reviews in one pass with within-batch near-duplicate campaign detection.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="batch-file-upload"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Upload className="h-3.5 w-3.5" aria-hidden="true" />
              Upload CSV / JSON
              <input
                id="batch-file-upload"
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={handleFileUpload}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              onClick={() => setRawInput(SAMPLE_CSV)}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Load Sample Dataset
            </button>
          </div>
        </div>

        <form aria-labelledby={headingId} onSubmit={handleRunBatch} className="space-y-4">
          <div>
            <label
              htmlFor="batch-raw-input"
              className="mb-1.5 block text-xs font-medium text-slate-700 dark:text-slate-300"
            >
              CSV (with header) or JSON Array
            </label>
            <textarea
              id="batch-raw-input"
              name="batchInput"
              rows={7}
              value={rawInput}
              onChange={(e) => setRawInput(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            />
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/50 dark:text-rose-300"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Scanning Batch...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" aria-hidden="true" />
                Run Batch ML Audit
              </>
            )}
          </button>
        </form>
      </section>

      {batchResult && (
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                Batch Audit Summary ({batchResult.total} reviews &bull; {batchResult.avg_latency_ms}ms avg)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {batchResult.fake_count} fake ({batchResult.fake_rate}%), {batchResult.genuine_count} genuine,{" "}
                {batchResult.quarantined_count} auto-quarantined
              </p>
            </div>

            <button
              type="button"
              onClick={handleDownloadBatchCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              Download Audit CSV
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Batch fake review classification results</caption>
              <thead>
                <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  <th scope="col" className="py-2 pr-3 font-semibold">Product</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Reviewer</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Rating</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Verdict</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Fake %</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Dup %</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Review Excerpt</th>
                  <th scope="col" className="pl-3 py-2 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {batchResult.results.map((row, idx) => (
                  <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/40">
                    <td className="py-2.5 pr-3 font-medium">{row.product_name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{row.reviewer}</td>
                    <td className="px-3 py-2.5 tabular-nums">{row.rating}★</td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          row.prediction.is_fake
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                        }`}
                      >
                        {row.prediction.verdict}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums font-semibold">
                      {row.prediction.fake_probability.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {row.prediction.duplicate_similarity.toFixed(0)}%
                    </td>
                    <td className="max-w-xs truncate px-3 py-2.5 text-slate-600 dark:text-slate-300">
                      {row.text}
                    </td>
                    <td className="pl-3 py-2.5">
                      {mappedRecords[idx] && (
                        <button
                          type="button"
                          onClick={() => onInspect(mappedRecords[idx])}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                        >
                          <Eye className="h-3 w-3" aria-hidden="true" />
                          Inspect
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
