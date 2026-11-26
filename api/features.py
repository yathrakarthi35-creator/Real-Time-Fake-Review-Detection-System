"""
Shared NLP & Behavioral Feature Engineering + Explainability Engine.
Imported by both train_model.py and api/index.py to guarantee zero train/serve skew.
Zero heavy dependencies (uses Python stdlib + numpy only).
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Tuple

import numpy as np

# Compact, high-signal lexicons for fast (<2ms) sentiment & deception feature extraction
POSITIVE_WORDS = {
    "amazing", "awesome", "best", "brilliant", "comfortable", "durable", "excellent",
    "fantastic", "fast", "good", "great", "happy", "helpful", "impressive", "incredible",
    "love", "loved", "nice", "outstanding", "perfect", "pleased", "quality", "recommend",
    "recommended", "reliable", "satisfied", "solid", "sturdy", "superb", "wonderful",
    "worth", "flawless", "phenomenal", "miracle", "unbelievable", "obsessed", "genius",
    "clean", "smooth", "responsive", "value", "accurate", "quiet", "bright", "crisp",
}

NEGATIVE_WORDS = {
    "awful", "bad", "broken", "cheap", "crap", "damaged", "defective", "disappointed",
    "disappointing", "fake", "fraud", "garbage", "horrible", "junk", "never", "poor",
    "regret", "return", "returned", "ripoff", "rubbish", "scam", "slow", "stopped",
    "terrible", "trash", "unusable", "useless", "waste", "worst", "worthless", "lied",
    "pathetic", "disaster", "overpriced", "flimsy", "noisy", "leaking", "dead",
}

HYPE_PHRASES = [
    "best ever", "best product ever", "100% recommend", "highly recommend",
    "must buy", "buy now", "life changing", "life-changing", "changed my life",
    "five stars", "5 stars", "10/10", "worth every penny", "do not hesitate",
    "don't hesitate", "you won't regret", "game changer", "game-changer",
    "literally the best", "hands down the best", "exceeded all expectations",
    "zero flaws", "absolute perfection", "buy this right now", "stop looking",
    "total scam", "complete garbage", "worst ever", "stay far away", "do not buy",
    "zero stars", "0 stars", "run away", "total ripoff", "complete waste",
]

SPECIFICITY_CUES = {
    "week", "weeks", "month", "months", "year", "years", "day", "days", "hour", "hours",
    "battery", "cable", "charger", "screen", "button", "zipper", "stitching", "fabric",
    "size", "fit", "weight", "inches", "mm", "cm", "watts", "usb", "bluetooth", "wifi",
    "packaging", "delivery", "shipping", "manual", "setup", "install", "warranty",
    "support", "replacement", "however", "although", "though", "except", "minor",
    "slightly", "downside", "con", "pro", "pros", "cons", "overall", "compared",
    "previous", "version", "model", "color", "material", "plastic", "metal", "steel",
    "noise", "temperature", "heat", "wash", "washed", "shrink", "fit", "tight", "loose",
}

FIRST_PERSON_WORDS = {"i", "me", "my", "mine", "myself", "we", "our", "us"}

FEATURE_NAMES = [
    "sentiment_polarity",
    "sentiment_subjectivity",
    "exclamation_ratio",
    "caps_ratio",
    "word_count_log",
    "char_length_log",
    "rating_extremity",
    "verified_purchase",
    "rating_sentiment_mismatch",
    "generic_praise_density",
    "specificity_score",
    "repetition_ratio",
]

TOKEN_RE = re.compile(r"[A-Za-z0-9']+")
REPEAT_PUNCT_RE = re.compile(r"([!?])\1{1,}")
NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")


def extract_behavioral_dict(
    text: str,
    rating: int,
    verified_purchase: bool,
) -> Dict[str, float]:
    """Compute 12 deterministic behavioral & linguistic features from a review."""
    cleaned = (text or "").strip()
    lower = cleaned.lower()
    tokens = TOKEN_RE.findall(lower)
    word_count = len(tokens)
    char_len = len(cleaned)

    pos_hits = sum(1 for t in tokens if t in POSITIVE_WORDS)
    neg_hits = sum(1 for t in tokens if t in NEGATIVE_WORDS)
    sent_total = pos_hits + neg_hits

    sentiment_polarity = (pos_hits - neg_hits) / (sent_total + 1.0)
    sentiment_subjectivity = sent_total / max(word_count, 1)

    excl_count = cleaned.count("!")
    exclamation_ratio = min(excl_count / max(char_len, 1) * 20.0, 2.0)

    alpha_chars = [c for c in cleaned if c.isalpha()]
    upper_chars = [c for c in alpha_chars if c.isupper()]
    caps_ratio = len(upper_chars) / max(len(alpha_chars), 1)

    word_count_log = math.log1p(word_count)
    char_length_log = math.log1p(char_len)

    # 1 or 5 stars = 1.0 (extreme), 2 or 4 = 0.5, 3 = 0.0
    rating_clamped = max(1, min(5, int(rating)))
    rating_extremity = abs(rating_clamped - 3) / 2.0
    verified_num = 1.0 if verified_purchase else 0.0

    # Expected sentiment from rating in [-1, 1]
    expected_polarity = (rating_clamped - 3.0) / 2.0
    rating_sentiment_mismatch = abs(expected_polarity - sentiment_polarity)

    hype_hits = sum(1 for phrase in HYPE_PHRASES if phrase in lower)
    generic_praise_density = min(hype_hits / max(word_count / 10.0, 1.0), 3.0)

    spec_hits = sum(1 for t in tokens if t in SPECIFICITY_CUES)
    num_hits = len(NUMBER_RE.findall(cleaned))
    specificity_score = min((spec_hits + 0.7 * num_hits) / max(word_count / 12.0, 1.0), 3.0)

    unique_ratio = len(set(tokens)) / max(word_count, 1)
    repeat_punct_hits = len(REPEAT_PUNCT_RE.findall(cleaned))
    repetition_ratio = min((1.0 - unique_ratio) + 0.25 * repeat_punct_hits, 2.0)

    return {
        "sentiment_polarity": round(float(sentiment_polarity), 4),
        "sentiment_subjectivity": round(float(sentiment_subjectivity), 4),
        "exclamation_ratio": round(float(exclamation_ratio), 4),
        "caps_ratio": round(float(caps_ratio), 4),
        "word_count_log": round(float(word_count_log), 4),
        "char_length_log": round(float(char_length_log), 4),
        "rating_extremity": round(float(rating_extremity), 4),
        "verified_purchase": round(float(verified_num), 4),
        "rating_sentiment_mismatch": round(float(rating_sentiment_mismatch), 4),
        "generic_praise_density": round(float(generic_praise_density), 4),
        "specificity_score": round(float(specificity_score), 4),
        "repetition_ratio": round(float(repetition_ratio), 4),
    }


def extract_behavioral_vector(
    text: str,
    rating: int,
    verified_purchase: bool,
) -> np.ndarray:
    """Return ordered 1D numpy array matching FEATURE_NAMES."""
    feats = extract_behavioral_dict(text, rating, verified_purchase)
    return np.array([feats[name] for name in FEATURE_NAMES], dtype=np.float64)


def heuristic_fake_probability(
    text: str,
    rating: int,
    verified_purchase: bool,
) -> float:
    """
    Lightweight fallback probability estimator in [0.02, 0.98] if model.joblib is absent.
    """
    f = extract_behavioral_dict(text, rating, verified_purchase)
    cleaned = (text or "").strip()
    word_count = len(TOKEN_RE.findall(cleaned))

    score = -0.35
    if not verified_purchase:
        score += 0.95
    else:
        score -= 0.55

    score += 1.15 * f["generic_praise_density"]
    score += 0.95 * f["exclamation_ratio"]
    score += 2.20 * max(0.0, f["caps_ratio"] - 0.15)
    score += 0.55 * f["rating_extremity"]
    score += 0.70 * max(0.0, f["rating_sentiment_mismatch"] - 0.75)
    score += 0.85 * max(0.0, f["repetition_ratio"] - 0.35)
    score -= 0.95 * f["specificity_score"]

    if word_count < 12 and f["rating_extremity"] == 1.0:
        score += 0.65
    elif word_count >= 25 and f["specificity_score"] >= 0.45:
        score -= 0.70

    prob = 1.0 / (1.0 + math.exp(-score))
    return float(max(0.02, min(0.98, prob)))


def build_explainability(
    text: str,
    rating: int,
    verified_purchase: bool,
    model_trigger_words: List[Dict[str, Any]] | None = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Build human-readable explainability:
    - trigger_words: exact matched words/phrases with impact ('fake' or 'genuine')
    - red_flags: concrete behavioral deception indicators
    - green_flags: concrete authenticity indicators
    """
    cleaned = (text or "").strip()
    lower = cleaned.lower()
    tokens = TOKEN_RE.findall(lower)
    word_count = len(tokens)
    f = extract_behavioral_dict(cleaned, rating, verified_purchase)

    red_flags: List[Dict[str, Any]] = []
    green_flags: List[Dict[str, Any]] = []

    # 1. Verified purchase check
    if not verified_purchase:
        red_flags.append({
            "code": "UNVERIFIED_PURCHASE",
            "title": "Unverified purchase",
            "detail": "Reviewer has no confirmed purchase record for this product.",
            "severity": "high",
        })
    else:
        green_flags.append({
            "code": "VERIFIED_PURCHASE",
            "title": "Verified purchase confirmed",
            "detail": "Order history confirms the reviewer bought this item.",
            "severity": "positive",
        })

    # 2. Excessive punctuation
    excl_count = cleaned.count("!")
    if excl_count >= 3 or REPEAT_PUNCT_RE.search(cleaned):
        red_flags.append({
            "code": "EXCESSIVE_PUNCTUATION",
            "title": "Excessive punctuation",
            "detail": f"Detected {excl_count} exclamation mark(s) or repeated punctuation patterns typical of hype spam.",
            "severity": "high" if excl_count >= 4 else "medium",
        })

    # 3. All-caps shouting
    if f["caps_ratio"] >= 0.22 and len(cleaned) >= 15:
        pct = round(f["caps_ratio"] * 100)
        red_flags.append({
            "code": "EXCESSIVE_CAPS",
            "title": "Abnormal uppercase ratio",
            "detail": f"{pct}% of alphabetic characters are capitalized, a strong promotional/rant marker.",
            "severity": "high" if f["caps_ratio"] >= 0.4 else "medium",
        })

    # 4. Extreme rating with generic praise or low specificity
    if rating == 5 and (f["generic_praise_density"] >= 0.5 or (word_count <= 18 and f["specificity_score"] < 0.35)):
        red_flags.append({
            "code": "EXTREME_5_STAR_GENERIC",
            "title": "Extreme 5-star rating with generic praise",
            "detail": "Maximum rating paired with promotional clichés and minimal concrete product details.",
            "severity": "high",
        })
    elif rating == 1 and (f["generic_praise_density"] >= 0.5 or (word_count <= 18 and f["specificity_score"] < 0.35)):
        red_flags.append({
            "code": "EXTREME_1_STAR_GENERIC",
            "title": "Extreme 1-star rating with generic hostility",
            "detail": "Minimum rating lacking specific defect details, resembling competitor sabotage.",
            "severity": "high",
        })

    # 5. Rating vs. sentiment contradiction
    if f["rating_sentiment_mismatch"] >= 1.05:
        red_flags.append({
            "code": "RATING_SENTIMENT_MISMATCH",
            "title": "Rating contradicts review tone",
            "detail": f"A {rating}-star rating does not align with the detected text polarity ({f['sentiment_polarity']:+.2f}).",
            "severity": "medium",
        })

    # 6. Very short review with extreme rating
    if word_count < 10 and f["rating_extremity"] == 1.0:
        red_flags.append({
            "code": "SHORT_EXTREME_REVIEW",
            "title": "Very short extreme review",
            "detail": f"Only {word_count} words submitted alongside an extreme {rating}-star score.",
            "severity": "medium",
        })

    # 7. Specificity & balanced critique (green flags)
    if f["specificity_score"] >= 0.55 and word_count >= 16:
        green_flags.append({
            "code": "HIGH_SPECIFICITY",
            "title": "Concrete product & usage details",
            "detail": "Mentions measurable attributes, usage timeframes, or specific component feedback.",
            "severity": "positive",
        })

    if any(w in tokens for w in ("however", "although", "though", "downside", "minor", "except", "overall")):
        green_flags.append({
            "code": "BALANCED_PERSPECTIVE",
            "title": "Balanced perspective",
            "detail": "Contains nuanced trade-off language rarely found in paid astroturfing.",
            "severity": "positive",
        })

    if rating in (2, 3, 4):
        green_flags.append({
            "code": "MODERATE_RATING",
            "title": "Non-extreme star rating",
            "detail": f"{rating}-star ratings are statistically much less common in coordinated fake bursts.",
            "severity": "positive",
        })

    # Build trigger words list (combine hype phrases + model TF-IDF weights + specificity words)
    seen = set()
    triggers: List[Dict[str, Any]] = []

    for phrase in HYPE_PHRASES:
        if phrase in lower and phrase not in seen:
            seen.add(phrase)
            triggers.append({
                "word": phrase,
                "impact": "fake",
                "category": "Promotional / Hype Phrase",
                "weight": 0.85,
            })

    if model_trigger_words:
        for item in model_trigger_words:
            w = item["word"]
            if w not in seen:
                seen.add(w)
                triggers.append(item)

    # Also highlight concrete specificity cues present in text
    for t in tokens:
        if t in SPECIFICITY_CUES and t not in seen and len(triggers) < 12:
            seen.add(t)
            triggers.append({
                "word": t,
                "impact": "genuine",
                "category": "Specific Detail Cue",
                "weight": 0.45,
            })

    # Sort fake triggers first by descending weight
    triggers.sort(key=lambda x: (0 if x["impact"] == "fake" else 1, -x["weight"]))
    return triggers[:10], red_flags, green_flags
