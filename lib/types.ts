export type ModerationStatus = "APPROVED" | "FLAGGED_FOR_REVIEW" | "AUTO_QUARANTINED";

export type SimulationScenario =
  | "normal"
  | "hype_burst"
  | "ai_astroturf"
  | "competitor_sabotage"
  | "duplicate_botnet";

export interface TriggerWord {
  word: string;
  impact: "fake" | "genuine";
  category: string;
  weight: number;
}

export interface FlagItem {
  code: string;
  title: string;
  detail: string;
  severity: "high" | "medium" | "positive";
}

export interface PredictionResponse {
  verdict: "FAKE / DECEPTIVE" | "GENUINE";
  is_fake: boolean;
  fake_probability: number;
  confidence: number;
  risk_level: "HIGH" | "MEDIUM" | "LOW";
  moderation_status: ModerationStatus;
  analyst_reviewed?: boolean;
  latency_ms: number;
  engine: string;
  duplicate_similarity: number;
  burst_spike: boolean;
  trigger_words: TriggerWord[];
  red_flags: FlagItem[];
  green_flags: FlagItem[];
  behavioral_metrics: Record<string, number>;
  published_record?: ScannedReviewRecord | null;
}

export interface ScannedReviewRecord {
  id: string;
  timestamp: string;
  source: "manual" | "stream" | "webhook" | "batch";
  product_name: string;
  reviewer: string;
  text: string;
  rating: number;
  verified_purchase: boolean;
  account_age_days?: number | null;
  reviewer_review_count?: number | null;
  prediction: PredictionResponse;
}

export interface ProductRiskRow {
  product_name: string;
  total_reviews: number;
  fake_count: number;
  quarantined_count: number;
  fake_rate: number;
  raw_avg_rating: number;
  trust_adjusted_rating: number;
  under_attack: boolean;
}

export interface HealthStatus {
  status: string;
  model_loaded: boolean;
  model_format?: string | null;
  model_type: string;
  accuracy: number | null;
  roc_auc: number | null;
  f1_score?: number | null;
  trained_at: string | null;
  feature_count: number;
  active_sse_clients?: number;
  storage_mode: string;
  note: string | null;
  timestamp: string;
}

export interface BatchPredictResponse {
  total: number;
  fake_count: number;
  genuine_count: number;
  quarantined_count: number;
  fake_rate: number;
  avg_latency_ms: number;
  results: Array<{
    product_name: string;
    reviewer: string;
    rating: number;
    verified_purchase: boolean;
    text: string;
    prediction: PredictionResponse;
  }>;
}

export const STORAGE_KEY = "frd_scanned_reviews_v2";
export const THEME_KEY = "frd_theme_v2";

export function loadStoredReviews(): ScannedReviewRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredReviews(records: ScannedReviewRecord[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 300)));
  } catch {
    // Ignore storage quota errors
  }
}

export function computeProductLeaderboard(records: ScannedReviewRecord[]): ProductRiskRow[] {
  const grouped = new Map<string, ScannedReviewRecord[]>();
  for (const rec of records) {
    const key = rec.product_name || "Custom Product";
    const list = grouped.get(key) ?? [];
    list.push(rec);
    grouped.set(key, list);
  }

  const rows: ProductRiskRow[] = [];
  grouped.forEach((items, product_name) => {
    const total_reviews = items.length;
    const fake_count = items.filter((r) => r.prediction.is_fake).length;
    const quarantined_count = items.filter(
      (r) => r.prediction.moderation_status === "AUTO_QUARANTINED"
    ).length;
    const raw_avg_rating = items.reduce((sum, r) => sum + r.rating, 0) / total_reviews;
    const genuineItems = items.filter((r) => !r.prediction.is_fake);
    const trust_adjusted_rating =
      genuineItems.length > 0
        ? genuineItems.reduce((sum, r) => sum + r.rating, 0) / genuineItems.length
        : raw_avg_rating;
    const fake_rate = (fake_count / total_reviews) * 100;

    rows.push({
      product_name,
      total_reviews,
      fake_count,
      quarantined_count,
      fake_rate: Number(fake_rate.toFixed(1)),
      raw_avg_rating: Number(raw_avg_rating.toFixed(2)),
      trust_adjusted_rating: Number(trust_adjusted_rating.toFixed(2)),
      under_attack: total_reviews >= 3 && fake_rate >= 55,
    });
  });

  return rows.sort((a, b) => b.fake_rate - a.fake_rate || b.total_reviews - a.total_reviews);
}

export function exportReviewsToCsv(records: ScannedReviewRecord[]): string {
  const header = [
    "id",
    "timestamp",
    "source",
    "product_name",
    "reviewer",
    "rating",
    "verified_purchase",
    "verdict",
    "fake_probability_pct",
    "confidence_pct",
    "moderation_status",
    "latency_ms",
    "red_flags",
    "text",
  ];

  const escapeCell = (val: unknown): string => {
    const str = String(val ?? "");
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [header.join(",")];
  for (const r of records) {
    lines.push(
      [
        r.id,
        r.timestamp,
        r.source,
        r.product_name,
        r.reviewer,
        r.rating,
        r.verified_purchase,
        r.prediction.verdict,
        r.prediction.fake_probability,
        r.prediction.confidence,
        r.prediction.moderation_status,
        r.prediction.latency_ms,
        r.prediction.red_flags.map((f) => f.title).join("; "),
        r.text,
      ]
        .map(escapeCell)
        .join(",")
    );
  }
  return lines.join("\n");
}
