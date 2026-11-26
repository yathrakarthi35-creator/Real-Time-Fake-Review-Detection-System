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
  latency_ms: number;
  engine: string;
  trigger_words: TriggerWord[];
  red_flags: FlagItem[];
  green_flags: FlagItem[];
  behavioral_metrics: Record<string, number>;
}

export interface ScannedReviewRecord {
  id: string;
  timestamp: string;
  source: "manual" | "stream";
  product_name: string;
  reviewer: string;
  text: string;
  rating: number;
  verified_purchase: boolean;
  prediction: PredictionResponse;
}

export interface HealthStatus {
  status: string;
  model_loaded: boolean;
  model_type: string;
  accuracy: number | null;
  roc_auc: number | null;
  trained_at: string | null;
  feature_count: number;
  storage_mode: string;
  note: string | null;
  timestamp: string;
}

export const STORAGE_KEY = "frd_scanned_reviews_v1";
export const THEME_KEY = "frd_theme_v1";

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
    // Keep most recent 250 records in localStorage to stay fast and lightweight
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 250)));
  } catch {
    // Ignore storage quota errors
  }
}
