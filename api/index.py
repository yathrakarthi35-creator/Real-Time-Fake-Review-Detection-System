"""
FastAPI Backend for Real-Time Fake Review Detection System.
Supports both local uvicorn (with live SSE + sliding-window memory) and
Vercel Serverless deployment (/api/* via vercel.json).

Model loading priority:
1. api/model.joblib  (Scikit-learn Pipeline if present)
2. api/model.json.gz (pre-trained TF-IDF + Behavioral Logistic Regression, zero sklearn runtime needed)
3. Deterministic behavioral fallback
"""

from __future__ import annotations

import asyncio
import gzip
import json
import math
import os
import random
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import numpy as np
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

try:
    from api.features import (
        FEATURE_NAMES,
        STOP_WORDS,
        build_explainability,
        compute_trigram_shingles,
        extract_behavioral_dict,
        extract_behavioral_vector,
        heuristic_fake_probability,
        jaccard_similarity,
    )
    from api.stream_engine import format_sse_event, stream_engine
except ImportError:
    from features import (  # type: ignore
        FEATURE_NAMES,
        STOP_WORDS,
        build_explainability,
        compute_trigram_shingles,
        extract_behavioral_dict,
        extract_behavioral_vector,
        heuristic_fake_probability,
        jaccard_similarity,
    )
    from stream_engine import format_sse_event, stream_engine  # type: ignore

app = FastAPI(
    title="Real-Time Fake Review Detection API",
    version="2.0.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

JOBLIB_PATH = CURRENT_DIR / "model.joblib"
JSON_GZ_PATH = CURRENT_DIR / "model.json.gz"

MODEL_BUNDLE: Optional[Dict[str, Any]] = None
MODEL_FORMAT: Optional[str] = None
MODEL_LOAD_ERROR: Optional[str] = None

NGRAM_TOKEN_RE = re.compile(r"[a-z0-9']+")


def load_model_bundle() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    global MODEL_BUNDLE, MODEL_FORMAT, MODEL_LOAD_ERROR
    if MODEL_BUNDLE is not None:
        return MODEL_BUNDLE, MODEL_FORMAT

    if JOBLIB_PATH.exists():
        try:
            import joblib

            MODEL_BUNDLE = joblib.load(JOBLIB_PATH)
            MODEL_FORMAT = "joblib"
            MODEL_LOAD_ERROR = None
            return MODEL_BUNDLE, MODEL_FORMAT
        except Exception as exc:
            MODEL_LOAD_ERROR = f"Could not load model.joblib ({exc}); falling back to model.json.gz"

    if JSON_GZ_PATH.exists():
        try:
            with gzip.open(JSON_GZ_PATH, "rt", encoding="utf-8") as gz:
                raw = json.load(gz)
            raw["_idf_np"] = np.array(raw["idf"], dtype=np.float64)
            raw["_behav_mean_np"] = np.array(raw["behav_mean"], dtype=np.float64)
            raw["_behav_std_np"] = np.array(raw["behav_std"], dtype=np.float64)
            raw["_weights_np"] = np.array(raw["weights"], dtype=np.float64)
            MODEL_BUNDLE = raw
            MODEL_FORMAT = "json_gz"
            MODEL_LOAD_ERROR = None
            return MODEL_BUNDLE, MODEL_FORMAT
        except Exception as exc:
            MODEL_LOAD_ERROR = f"Failed to load model.json.gz: {exc}"

    if not MODEL_LOAD_ERROR:
        MODEL_LOAD_ERROR = "No trained model artifact found; running deterministic behavioral fallback."
    return None, None


load_model_bundle()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
ModerationStatus = Literal["APPROVED", "FLAGGED_FOR_REVIEW", "AUTO_QUARANTINED"]
SimulationScenario = Literal[
    "normal",
    "hype_burst",
    "ai_astroturf",
    "competitor_sabotage",
    "duplicate_botnet",
]


class ReviewRequest(BaseModel):
    text: str = Field(..., min_length=2, max_length=5000, description="The review text to analyze")
    rating: int = Field(5, ge=1, le=5, description="Star rating from 1 to 5")
    verified_purchase: bool = Field(True, description="Whether the reviewer is a verified buyer")
    product_name: Optional[str] = Field("Custom Product", max_length=120)
    reviewer: Optional[str] = Field("Anonymous Reviewer", max_length=80)
    account_age_days: Optional[int] = Field(None, ge=0, le=10000)
    reviewer_review_count: Optional[int] = Field(None, ge=0, le=50000)
    publish_to_stream: bool = Field(False, description="Publish prediction into live SSE stream")


class TriggerWord(BaseModel):
    word: str
    impact: str
    category: str
    weight: float


class FlagItem(BaseModel):
    code: str
    title: str
    detail: str
    severity: str


class PredictionResponse(BaseModel):
    verdict: str
    is_fake: bool
    fake_probability: float
    confidence: float
    risk_level: str
    moderation_status: ModerationStatus
    analyst_reviewed: bool = False
    latency_ms: float
    engine: str
    duplicate_similarity: float
    burst_spike: bool
    trigger_words: List[TriggerWord]
    red_flags: List[FlagItem]
    green_flags: List[FlagItem]
    behavioral_metrics: Dict[str, float]
    published_record: Optional[Dict[str, Any]] = None


class BatchReviewRequest(BaseModel):
    reviews: List[ReviewRequest] = Field(..., min_length=1, max_length=200)


class ModerationUpdateRequest(BaseModel):
    moderation_status: ModerationStatus


# ---------------------------------------------------------------------------
# Core Inference
# ---------------------------------------------------------------------------
def extract_sklearn_trigger_words(pipeline: Any, text: str) -> List[Dict[str, Any]]:
    try:
        preprocessor = pipeline.named_steps["features"]
        clf = pipeline.named_steps["clf"]
        tfidf = preprocessor.named_transformers_["tfidf"]
        if not hasattr(clf, "coef_"):
            return []

        vec = tfidf.transform([text])
        feature_names = tfidf.get_feature_names_out()
        coefs = clf.coef_[0]

        indices = vec.nonzero()[1]
        contributions: List[Dict[str, Any]] = []
        for idx in indices:
            score = float(vec[0, idx] * coefs[idx])
            if abs(score) < 0.06:
                continue
            contributions.append({
                "word": str(feature_names[idx]),
                "impact": "fake" if score > 0 else "genuine",
                "category": "ML Text Signal (TF-IDF)",
                "weight": round(min(abs(score), 1.0), 3),
            })

        contributions.sort(key=lambda x: -x["weight"])
        return contributions[:8]
    except Exception:
        return []


def infer_json_gz_model(
    bundle: Dict[str, Any],
    text: str,
    behav_vec: np.ndarray,
) -> Tuple[float, List[Dict[str, Any]]]:
    vocab: Dict[str, int] = bundle["vocab"]
    idf: np.ndarray = bundle["_idf_np"]
    weights: np.ndarray = bundle["_weights_np"]
    bias: float = float(bundle["bias"])
    n_vocab = len(vocab)

    tokens = [t for t in NGRAM_TOKEN_RE.findall((text or "").lower()) if t not in STOP_WORDS]
    ngrams = list(tokens) + [f"{tokens[i]} {tokens[i + 1]}" for i in range(len(tokens) - 1)]
    counts = Counter(t for t in ngrams if t in vocab)

    tfidf_vec = np.zeros(n_vocab, dtype=np.float64)
    active_cols: List[Tuple[str, int]] = []
    for tok, cnt in counts.items():
        col = vocab[tok]
        tfidf_vec[col] = (1.0 + math.log(cnt)) * idf[col]
        active_cols.append((tok, col))

    norm = float(np.linalg.norm(tfidf_vec))
    if norm > 0.0:
        tfidf_vec /= norm

    behav_std = np.where(bundle["_behav_std_np"] == 0, 1.0, bundle["_behav_std_np"])
    behav_scaled = (behav_vec - bundle["_behav_mean_np"]) / behav_std
    z = float(np.dot(tfidf_vec, weights[:n_vocab]) + np.dot(behav_scaled, weights[n_vocab:]) + bias)
    z = max(-30.0, min(30.0, z))
    fake_prob = 1.0 / (1.0 + math.exp(-z))

    contributions: List[Dict[str, Any]] = []
    for tok, col in active_cols:
        score = float(tfidf_vec[col] * weights[col])
        if abs(score) < 0.003:
            continue
        contributions.append({
            "word": tok,
            "impact": "fake" if score > 0 else "genuine",
            "category": "ML Text Signal (TF-IDF)",
            "weight": round(min(abs(score) * 10.0, 1.0), 3),
        })
    contributions.sort(key=lambda x: -x["weight"])
    return fake_prob, contributions[:8]


def predict_single(
    req: ReviewRequest,
    stream_signals: Optional[Dict[str, Any]] = None,
) -> PredictionResponse:
    t0 = time.perf_counter()
    bundle, fmt = load_model_bundle()
    product_name = (req.product_name or "Custom Product").strip() or "Custom Product"

    behav_dict = extract_behavioral_dict(
        req.text,
        req.rating,
        req.verified_purchase,
        account_age_days=req.account_age_days,
        reviewer_review_count=req.reviewer_review_count,
    )
    behav_vec = extract_behavioral_vector(
        req.text,
        req.rating,
        req.verified_purchase,
        account_age_days=req.account_age_days,
        reviewer_review_count=req.reviewer_review_count,
    )

    model_triggers: List[Dict[str, Any]] = []
    if bundle is not None and fmt == "joblib" and "pipeline" in bundle:
        pipeline = bundle["pipeline"]
        row = np.empty((1, 1 + len(FEATURE_NAMES)), dtype=object)
        row[0, 0] = req.text
        row[0, 1:] = behav_vec
        fake_prob = float(pipeline.predict_proba(row)[0, 1])
        model_triggers = extract_sklearn_trigger_words(pipeline, req.text)
        engine = bundle.get("model_type", "Scikit-learn Pipeline v2")
    elif bundle is not None and fmt == "json_gz":
        fake_prob, model_triggers = infer_json_gz_model(bundle, req.text, behav_vec)
        engine = bundle.get("model_type", "TF-IDF + Behavioral LogisticRegression v2")
    else:
        fake_prob = heuristic_fake_probability(
            req.text,
            req.rating,
            req.verified_purchase,
            account_age_days=req.account_age_days,
            reviewer_review_count=req.reviewer_review_count,
        )
        engine = "Behavioral Heuristic Fallback"

    # Cross-review stream risk adjustment (near-duplicate campaign & burst spike)
    ctx = stream_signals if stream_signals is not None else stream_engine.inspect_context(req.text, product_name)
    dup_sim = float(ctx.get("duplicate_similarity", 0.0))
    burst_spike = bool(ctx.get("burst_spike", False))

    if dup_sim >= 0.70:
        fake_prob = max(fake_prob, 0.90)
    elif dup_sim >= 0.50:
        fake_prob = min(0.98, fake_prob + 0.22)

    if burst_spike and not req.verified_purchase and req.rating in (1, 5):
        fake_prob = min(0.98, fake_prob + 0.14)

    is_fake = fake_prob >= 0.50
    verdict = "FAKE / DECEPTIVE" if is_fake else "GENUINE"
    confidence = (fake_prob if is_fake else (1.0 - fake_prob)) * 100.0

    if fake_prob >= 0.75:
        risk_level = "HIGH"
    elif fake_prob >= 0.45:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    if fake_prob >= 0.78 or dup_sim >= 0.70:
        moderation_status: ModerationStatus = "AUTO_QUARANTINED"
    elif fake_prob >= 0.45:
        moderation_status = "FLAGGED_FOR_REVIEW"
    else:
        moderation_status = "APPROVED"

    triggers, red_flags, green_flags = build_explainability(
        req.text,
        req.rating,
        req.verified_purchase,
        model_trigger_words=model_triggers,
        account_age_days=req.account_age_days,
        reviewer_review_count=req.reviewer_review_count,
        stream_signals=ctx,
    )

    latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    return PredictionResponse(
        verdict=verdict,
        is_fake=is_fake,
        fake_probability=round(fake_prob * 100.0, 1),
        confidence=round(confidence, 1),
        risk_level=risk_level,
        moderation_status=moderation_status,
        analyst_reviewed=False,
        latency_ms=latency_ms,
        engine=engine,
        duplicate_similarity=round(dup_sim * 100.0, 1),
        burst_spike=burst_spike,
        trigger_words=[TriggerWord(**t) for t in triggers],
        red_flags=[FlagItem(**rf) for rf in red_flags],
        green_flags=[FlagItem(**gf) for gf in green_flags],
        behavioral_metrics=behav_dict,
    )


def build_stream_record(
    req: ReviewRequest,
    prediction: PredictionResponse,
    source: str,
) -> Dict[str, Any]:
    return {
        "id": f"rev_{int(time.time() * 1000)}_{random.randint(100, 999)}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": source,
        "product_name": (req.product_name or "Custom Product").strip() or "Custom Product",
        "reviewer": (req.reviewer or "Anonymous Reviewer").strip() or "Anonymous Reviewer",
        "text": req.text,
        "rating": req.rating,
        "verified_purchase": req.verified_purchase,
        "account_age_days": req.account_age_days,
        "reviewer_review_count": req.reviewer_review_count,
        "prediction": prediction.model_dump(),
    }


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health_check() -> Dict[str, Any]:
    bundle, fmt = load_model_bundle()
    return {
        "status": "ok",
        "model_loaded": bundle is not None,
        "model_format": fmt,
        "model_type": bundle.get("model_type") if bundle else "Behavioral Heuristic Fallback",
        "accuracy": bundle.get("accuracy") if bundle else None,
        "roc_auc": bundle.get("roc_auc") if bundle else None,
        "f1_score": bundle.get("f1_score") if bundle else None,
        "trained_at": bundle.get("trained_at") if bundle else None,
        "feature_count": len(FEATURE_NAMES),
        "active_sse_clients": stream_engine.subscriber_count(),
        "storage_mode": "supabase" if os.getenv("SUPABASE_URL") else "realtime_ring_buffer",
        "note": MODEL_LOAD_ERROR,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/predict", response_model=PredictionResponse)
def predict_review(payload: ReviewRequest) -> PredictionResponse:
    pred = predict_single(payload)
    if payload.publish_to_stream:
        rec = build_stream_record(payload, pred, source="manual")
        stream_engine.record_and_broadcast(rec)
        pred.published_record = rec
    return pred


@app.post("/api/ingest")
def ingest_realtime_review(payload: ReviewRequest) -> Dict[str, Any]:
    """Real-time webhook ingestion endpoint: classifies, stores, and broadcasts via SSE."""
    pred = predict_single(payload)
    rec = build_stream_record(payload, pred, source="webhook")
    stream_engine.record_and_broadcast(rec)
    return rec


@app.post("/api/batch-predict")
def batch_predict(payload: BatchReviewRequest) -> Dict[str, Any]:
    """High-speed batch classification with within-batch near-duplicate detection."""
    seen_shingles: List[Tuple[str, Any]] = []
    results: List[Dict[str, Any]] = []

    for r in payload.reviews:
        shingles = compute_trigram_shingles(r.text)
        best_sim = 0.0
        matched_prod: Optional[str] = None
        for prev_prod, prev_shingles in seen_shingles[-100:]:
            sim = jaccard_similarity(shingles, prev_shingles)
            if sim > best_sim:
                best_sim = sim
                matched_prod = prev_prod
        seen_shingles.append((r.product_name or "Batch Item", shingles))

        ctx = {
            "duplicate_similarity": best_sim,
            "duplicate_product": matched_prod,
            "burst_spike": False,
            "product_recent_count": 0,
        }
        pred = predict_single(r, stream_signals=ctx).model_dump()
        results.append({
            "product_name": r.product_name or "Custom Product",
            "reviewer": r.reviewer or "Batch Reviewer",
            "rating": r.rating,
            "verified_purchase": r.verified_purchase,
            "text": r.text,
            "prediction": pred,
        })

    fake_count = sum(1 for item in results if item["prediction"]["is_fake"])
    quarantined_count = sum(
        1 for item in results if item["prediction"]["moderation_status"] == "AUTO_QUARANTINED"
    )
    avg_latency = round(
        sum(item["prediction"]["latency_ms"] for item in results) / max(len(results), 1), 2
    )
    return {
        "total": len(results),
        "fake_count": fake_count,
        "genuine_count": len(results) - fake_count,
        "quarantined_count": quarantined_count,
        "fake_rate": round((fake_count / max(len(results), 1)) * 100.0, 1),
        "avg_latency_ms": avg_latency,
        "results": results,
    }


@app.get("/api/stream/history")
def get_stream_history(limit: int = Query(100, ge=1, le=500)) -> Dict[str, Any]:
    return stream_engine.get_snapshot(limit=limit)


@app.post("/api/stream/simulate")
def simulate_stream_event(
    scenario: SimulationScenario = Query("normal", description="Traffic simulation profile"),
    count: int = Query(1, ge=1, le=20, description="Number of simulated events to emit"),
) -> Dict[str, Any]:
    last_rec: Optional[Dict[str, Any]] = None
    emitted: List[Dict[str, Any]] = []
    for _ in range(count):
        sample = stream_engine.pick_scenario_sample(scenario)
        req = ReviewRequest(
            text=sample["text"],
            rating=sample["rating"],
            verified_purchase=sample["verified_purchase"],
            product_name=sample["product_name"],
            reviewer=sample["reviewer"],
            account_age_days=sample.get("account_age_days"),
            reviewer_review_count=sample.get("reviewer_review_count"),
        )
        pred = predict_single(req)
        rec = build_stream_record(req, pred, source="stream")
        stream_engine.record_and_broadcast(rec)
        last_rec = rec
        emitted.append(rec)

    if count == 1 and last_rec is not None:
        return last_rec
    return {"count": len(emitted), "records": emitted}


@app.get("/api/sample-stream")
def get_sample_stream_legacy(
    burst: bool = Query(False),
    scenario: Optional[SimulationScenario] = Query(None),
) -> Dict[str, Any]:
    """Backward-compatible endpoint mapped to the real-time stream simulator."""
    chosen: SimulationScenario = scenario or ("hype_burst" if burst else "normal")
    return simulate_stream_event(scenario=chosen)


@app.post("/api/moderation/{review_id}")
def moderate_review(review_id: str, payload: ModerationUpdateRequest) -> Dict[str, Any]:
    updated = stream_engine.update_moderation(review_id, payload.moderation_status)
    if updated is None:
        raise HTTPException(status_code=404, detail="Review not found in active stream buffer")
    return updated


@app.post("/api/stream/reset")
def reset_stream() -> Dict[str, str]:
    stream_engine.reset()
    return {"status": "reset"}


@app.get("/api/stream/events")
async def stream_events_sse(request: Request) -> StreamingResponse:
    """True Server-Sent Events (SSE) endpoint pushing live reviews and moderation updates."""
    loop = asyncio.get_running_loop()
    queue = stream_engine.subscribe(loop)

    async def event_generator():
        is_vercel = bool(os.getenv("VERCEL"))
        started = time.monotonic()
        try:
            yield format_sse_event("snapshot", stream_engine.get_snapshot(limit=50))
            while True:
                if await request.is_disconnected():
                    break
                if is_vercel and (time.monotonic() - started) >= 7.0:
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield format_sse_event(event["type"], event["data"])
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            stream_engine.unsubscribe(loop, queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
