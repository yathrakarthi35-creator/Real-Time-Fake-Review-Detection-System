"""
FastAPI Serverless Backend for Real-Time Fake Review Detection System.
Deployed on Vercel at /api/* via vercel.json rewrites.

Model loading priority:
1. api/model.joblib  (if retrained locally via Scikit-learn train_model.py)
2. api/model.json.gz (pre-trained TF-IDF + Behavioral Logistic Regression bundled in repo)
3. Deterministic behavioral fallback (only if both artifacts are missing)

Endpoints:
- GET  /api/health         -> Service & ML model status
- POST /api/predict        -> Real-time review classification + explainability (<100ms)
- POST /api/batch-predict  -> Batch review classification
- GET  /api/sample-stream  -> Simulated live e-commerce review stream (normal or fake burst)
"""

from __future__ import annotations

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
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Ensure local sibling import works both under `uvicorn api.index:app` and Vercel serverless invocation
CURRENT_DIR = Path(__file__).resolve().parent
if str(CURRENT_DIR) not in sys.path:
    sys.path.insert(0, str(CURRENT_DIR))

try:
    from api.features import (
        FEATURE_NAMES,
        build_explainability,
        extract_behavioral_dict,
        extract_behavioral_vector,
        heuristic_fake_probability,
    )
except ImportError:
    from features import (  # type: ignore
        FEATURE_NAMES,
        build_explainability,
        extract_behavioral_dict,
        extract_behavioral_vector,
        heuristic_fake_probability,
    )

app = FastAPI(
    title="Real-Time Fake Review Detection API",
    version="1.1.0",
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

# ---------------------------------------------------------------------------
# Model Loading (Lazy / Cold-Start Safe)
# ---------------------------------------------------------------------------
JOBLIB_PATH = CURRENT_DIR / "model.joblib"
JSON_GZ_PATH = CURRENT_DIR / "model.json.gz"

MODEL_BUNDLE: Optional[Dict[str, Any]] = None
MODEL_FORMAT: Optional[str] = None  # "joblib" | "json_gz" | None
MODEL_LOAD_ERROR: Optional[str] = None

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from",
    "had", "has", "have", "he", "her", "hers", "him", "his", "in", "into", "is", "it",
    "its", "of", "on", "or", "she", "that", "the", "their", "them", "they", "this",
    "to", "was", "were", "will", "with", "you", "your",
}
NGRAM_TOKEN_RE = re.compile(r"[a-z0-9']+")


def load_model_bundle() -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    global MODEL_BUNDLE, MODEL_FORMAT, MODEL_LOAD_ERROR
    if MODEL_BUNDLE is not None:
        return MODEL_BUNDLE, MODEL_FORMAT

    # 1. Prefer user-retrained Scikit-learn joblib artifact if present
    if JOBLIB_PATH.exists():
        try:
            import joblib

            MODEL_BUNDLE = joblib.load(JOBLIB_PATH)
            MODEL_FORMAT = "joblib"
            MODEL_LOAD_ERROR = None
            return MODEL_BUNDLE, MODEL_FORMAT
        except Exception as exc:
            MODEL_LOAD_ERROR = f"Could not load model.joblib ({exc}); falling back to model.json.gz"

    # 2. Load bundled pre-trained TF-IDF + Behavioral Logistic Regression artifact
    if JSON_GZ_PATH.exists():
        try:
            with gzip.open(JSON_GZ_PATH, "rt", encoding="utf-8") as gz:
                raw = json.load(gz)
            raw["_idf_np"] = np.array(raw["idf"], dtype=np.float64)
            raw["_behav_mean_np"] = np.array(raw["behav_mean"], dtype=np.float64)
            raw["_behav_std_np"] = np.array(raw["behav_std"], dtype=np.float64)
            raw["_weights_np"] = np.array(raw["weights"], dtype=np.float64)
            raw["_inv_vocab"] = {idx: tok for tok, idx in raw["vocab"].items()}
            MODEL_BUNDLE = raw
            MODEL_FORMAT = "json_gz"
            MODEL_LOAD_ERROR = None
            return MODEL_BUNDLE, MODEL_FORMAT
        except Exception as exc:
            MODEL_LOAD_ERROR = f"Failed to load model.json.gz: {exc}"

    if not MODEL_LOAD_ERROR:
        MODEL_LOAD_ERROR = "No trained model artifact found; running deterministic behavioral fallback."
    return None, None


# Attempt cold-start load
load_model_bundle()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class ReviewRequest(BaseModel):
    text: str = Field(..., min_length=2, max_length=5000, description="The review text to analyze")
    rating: int = Field(5, ge=1, le=5, description="Star rating from 1 to 5")
    verified_purchase: bool = Field(True, description="Whether the reviewer is a verified buyer")
    product_name: Optional[str] = Field(None, max_length=120, description="Optional product title")


class TriggerWord(BaseModel):
    word: str
    impact: str  # "fake" | "genuine"
    category: str
    weight: float


class FlagItem(BaseModel):
    code: str
    title: str
    detail: str
    severity: str  # "high" | "medium" | "positive"


class PredictionResponse(BaseModel):
    verdict: str
    is_fake: bool
    fake_probability: float
    confidence: float
    risk_level: str
    latency_ms: float
    engine: str
    trigger_words: List[TriggerWord]
    red_flags: List[FlagItem]
    green_flags: List[FlagItem]
    behavioral_metrics: Dict[str, float]


class BatchReviewRequest(BaseModel):
    reviews: List[ReviewRequest] = Field(..., min_items=1, max_items=50)


# ---------------------------------------------------------------------------
# Core Inference + Model Coefficient Explainability
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
            if abs(score) < 0.08:
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
    """Run sub-millisecond TF-IDF + Behavioral Logistic Regression inference."""
    vocab: Dict[str, int] = bundle["vocab"]
    idf: np.ndarray = bundle["_idf_np"]
    weights: np.ndarray = bundle["_weights_np"]
    bias: float = float(bundle["bias"])
    n_vocab = len(vocab)

    tokens = [t for t in NGRAM_TOKEN_RE.findall((text or "").lower()) if len(t) > 1 and t not in STOP_WORDS]
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

    behav_scaled = (behav_vec - bundle["_behav_mean_np"]) / bundle["_behav_std_np"]
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


def predict_single(req: ReviewRequest) -> PredictionResponse:
    t0 = time.perf_counter()
    bundle, fmt = load_model_bundle()

    behav_dict = extract_behavioral_dict(req.text, req.rating, req.verified_purchase)
    behav_vec = extract_behavioral_vector(req.text, req.rating, req.verified_purchase)

    model_triggers: List[Dict[str, Any]] = []
    if bundle is not None and fmt == "joblib" and "pipeline" in bundle:
        pipeline = bundle["pipeline"]
        row = np.empty((1, 1 + len(FEATURE_NAMES)), dtype=object)
        row[0, 0] = req.text
        row[0, 1:] = behav_vec
        fake_prob = float(pipeline.predict_proba(row)[0, 1])
        model_triggers = extract_sklearn_trigger_words(pipeline, req.text)
        engine = bundle.get("model_type", "Scikit-learn Pipeline")
    elif bundle is not None and fmt == "json_gz":
        fake_prob, model_triggers = infer_json_gz_model(bundle, req.text, behav_vec)
        engine = bundle.get("model_type", "TF-IDF + Behavioral LogisticRegression")
    else:
        fake_prob = heuristic_fake_probability(req.text, req.rating, req.verified_purchase)
        engine = "Behavioral Heuristic Fallback"

    is_fake = fake_prob >= 0.50
    verdict = "FAKE / DECEPTIVE" if is_fake else "GENUINE"
    confidence = (fake_prob if is_fake else (1.0 - fake_prob)) * 100.0

    if fake_prob >= 0.75:
        risk_level = "HIGH"
    elif fake_prob >= 0.45:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"

    triggers, red_flags, green_flags = build_explainability(
        req.text,
        req.rating,
        req.verified_purchase,
        model_trigger_words=model_triggers,
    )

    latency_ms = round((time.perf_counter() - t0) * 1000.0, 2)

    return PredictionResponse(
        verdict=verdict,
        is_fake=is_fake,
        fake_probability=round(fake_prob * 100.0, 1),
        confidence=round(confidence, 1),
        risk_level=risk_level,
        latency_ms=latency_ms,
        engine=engine,
        trigger_words=[TriggerWord(**t) for t in triggers],
        red_flags=[FlagItem(**rf) for rf in red_flags],
        green_flags=[FlagItem(**gf) for gf in green_flags],
        behavioral_metrics=behav_dict,
    )


# ---------------------------------------------------------------------------
# Realistic E-Commerce Stream Simulator Pool
# ---------------------------------------------------------------------------
STREAM_GENUINE_POOL = [
    {
        "product_name": "AeroPods Pro ANC Earbuds",
        "reviewer": "Priya M.",
        "rating": 4,
        "verified_purchase": True,
        "text": "Used these earbuds on my daily 45-minute commute for 3 weeks. Noise cancellation blocks bus rumble well, though the silicone tips took a couple days to feel comfortable.",
    },
    {
        "product_name": "BrewMaster Drip Coffee Maker",
        "reviewer": "Daniel K.",
        "rating": 5,
        "verified_purchase": True,
        "text": "Brewing takes about 6 minutes for a full 10-cup carafe and the thermal pot keeps coffee hot for 2 hours. Minor downside is the water reservoir markings are hard to read in dim light.",
    },
    {
        "product_name": "KeyForge TKL Mechanical Keyboard",
        "reviewer": "Arjun S.",
        "rating": 4,
        "verified_purchase": True,
        "text": "Solid aluminum plate and crisp tactile switches right out of the box. Shipping arrived in 2 days with good packaging. Wish the detachable USB-C cable were braided.",
    },
    {
        "product_name": "PureAir HEPA-13 Purifier",
        "reviewer": "Elena R.",
        "rating": 3,
        "verified_purchase": True,
        "text": "Works quietly on sleep mode and noticeably reduced dust in our bedroom over the past month. However, replacement filters cost $38 each which adds up quickly.",
    },
    {
        "product_name": "TrailStride Running Shoes",
        "reviewer": "Marcus T.",
        "rating": 2,
        "verified_purchase": True,
        "text": "Cushioning felt fine on my first two 5km runs, but the toe box runs half a size narrow and caused blisters by week two. Returned them for a wider model.",
    },
    {
        "product_name": "VoltCore 20000mAh Power Bank",
        "reviewer": "Sneha V.",
        "rating": 5,
        "verified_purchase": True,
        "text": "Charged my phone three full times during a weekend train trip with 20% battery remaining. A bit heavier than my older 10000mAh unit, but the 45W USB-C output is reliable.",
    },
    {
        "product_name": "ChefCraft Ceramic Frying Pan",
        "reviewer": "Liam W.",
        "rating": 4,
        "verified_purchase": True,
        "text": "Even heat distribution on our induction stove and eggs slide right off after 6 weeks of use. Hand-washing only is slightly inconvenient, yet overall great value.",
    },
]

STREAM_FAKE_POOL = [
    {
        "product_name": "AeroPods Pro ANC Earbuds",
        "reviewer": "DealHunter992",
        "rating": 5,
        "verified_purchase": False,
        "text": "BEST EARBUDS EVER!!! 100% RECOMMEND!! Literally changed my life!! BUY THIS RIGHT NOW!! 5 STARS!!!",
    },
    {
        "product_name": "BrewMaster Drip Coffee Maker",
        "reviewer": "Shopper_X81",
        "rating": 5,
        "verified_purchase": False,
        "text": "Absolute perfection! Zero flaws! Exceeded all expectations! Hands down the best coffee maker on the market! Must buy!",
    },
    {
        "product_name": "PureAir HEPA-13 Purifier",
        "reviewer": "PromoBot_44",
        "rating": 1,
        "verified_purchase": False,
        "text": "TOTAL SCAM!! COMPLETE GARBAGE!! DO NOT BUY THIS!! Stay far away and run away from this fraud seller!! ZERO STARS!!",
    },
    {
        "product_name": "VoltCore 20000mAh Power Bank",
        "reviewer": "FastReview2026",
        "rating": 5,
        "verified_purchase": False,
        "text": "OMG AMAZING!! Best product ever!! Worth every penny!! Stop looking and buy now!! 10/10 game changer!!!",
    },
    {
        "product_name": "KeyForge TKL Mechanical Keyboard",
        "reviewer": "GuestUser77",
        "rating": 5,
        "verified_purchase": False,
        "text": "Superb! Incredible! Five stars! Love it so much! Best keyboard ever!",
    },
    {
        "product_name": "TrailStride Running Shoes",
        "reviewer": "Anonymous_904",
        "rating": 1,
        "verified_purchase": False,
        "text": "TRASH!! Complete waste of money!! Awful horrible terrible junk!! Worst ever!! Do not buy!!",
    },
]


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
        "trained_at": bundle.get("trained_at") if bundle else None,
        "feature_count": len(FEATURE_NAMES),
        "storage_mode": "supabase" if os.getenv("SUPABASE_URL") else "local_session",
        "note": MODEL_LOAD_ERROR,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/predict", response_model=PredictionResponse)
def predict_review(payload: ReviewRequest) -> PredictionResponse:
    return predict_single(payload)


@app.post("/api/batch-predict")
def batch_predict(payload: BatchReviewRequest) -> Dict[str, Any]:
    results = [predict_single(r).dict() for r in payload.reviews]
    fake_count = sum(1 for r in results if r["is_fake"])
    return {
        "total": len(results),
        "fake_count": fake_count,
        "genuine_count": len(results) - fake_count,
        "results": results,
    }


@app.get("/api/sample-stream")
def get_sample_stream(
    burst: bool = Query(False, description="If true, skew heavily toward deceptive reviews to simulate a fake review burst")
) -> Dict[str, Any]:
    """Return a single simulated incoming e-commerce review plus its real-time classification."""
    pick_fake = random.random() < (0.88 if burst else 0.38)
    sample = dict(random.choice(STREAM_FAKE_POOL if pick_fake else STREAM_GENUINE_POOL))
    req = ReviewRequest(
        text=sample["text"],
        rating=sample["rating"],
        verified_purchase=sample["verified_purchase"],
        product_name=sample["product_name"],
    )
    prediction = predict_single(req)
    return {
        "id": f"rev_{int(time.time() * 1000)}_{random.randint(100, 999)}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "product_name": sample["product_name"],
        "reviewer": sample["reviewer"],
        "rating": sample["rating"],
        "verified_purchase": sample["verified_purchase"],
        "text": sample["text"],
        "prediction": prediction.dict(),
    }
