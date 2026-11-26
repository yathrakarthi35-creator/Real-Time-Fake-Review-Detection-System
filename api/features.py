"""
Shared NLP & Behavioral Feature Engineering + Explainability Engine.
Imported by train_model.py, api/stream_engine.py, and api/index.py to guarantee
zero train/serve skew and <10ms serverless inference with zero heavy dependencies.
"""

from __future__ import annotations

import math
import re
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

# ---------------------------------------------------------------------------
# Compact, High-Signal Lexicons
# ---------------------------------------------------------------------------
POSITIVE_WORDS = {
    "amazing", "awesome", "best", "brilliant", "comfortable", "durable", "excellent",
    "fantastic", "fast", "good", "great", "happy", "helpful", "impressive", "incredible",
    "love", "loved", "nice", "outstanding", "perfect", "pleased", "quality", "recommend",
    "recommended", "reliable", "satisfied", "solid", "sturdy", "superb", "wonderful",
    "worth", "flawless", "phenomenal", "miracle", "unbelievable", "obsessed", "genius",
    "clean", "smooth", "responsive", "value", "accurate", "quiet", "bright", "crisp",
    "remarkable", "exceptional", "effortless", "unmatched", "superior",
}

NEGATIVE_WORDS = {
    "awful", "bad", "broken", "cheap", "crap", "damaged", "defective", "disappointed",
    "disappointing", "fake", "fraud", "garbage", "horrible", "junk", "never", "poor",
    "regret", "return", "returned", "ripoff", "rubbish", "scam", "slow", "stopped",
    "terrible", "trash", "unusable", "useless", "waste", "worst", "worthless", "lied",
    "pathetic", "disaster", "overpriced", "flimsy", "noisy", "leaking", "dead",
    "avoid", "malfunction", "unacceptable",
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
    "best purchase", "buy immediately",
]

# Polished LLM / template astroturfing phrases lacking authentic sensory details
AI_TEMPLATE_PHRASES = [
    "exceeded my expectations", "exceeded every expectation", "cannot recommend enough",
    "can't recommend enough", "worth every single penny", "truly remarkable",
    "unmatched quality", "seamlessly integrates", "elevated my daily",
    "couldn't be happier", "must-have addition", "in every possible way",
    "beyond impressed", "second to none", "look no further",
    "stands out from the crowd", "without a shadow of a doubt",
    "craftsmanship is unmatched", "transformed my experience",
    "top-notch quality", "delivers on every promise", "absolute delight",
]

SPECIFICITY_CUES = {
    "week", "weeks", "month", "months", "year", "years", "day", "days", "hour", "hours",
    "minute", "minutes", "battery", "cable", "charger", "screen", "button", "buttons",
    "zipper", "stitching", "fabric", "size", "fit", "weight", "inches", "mm", "cm",
    "watts", "usb", "usb-c", "bluetooth", "wifi", "packaging", "delivery", "shipping",
    "manual", "setup", "install", "warranty", "support", "replacement", "however",
    "although", "though", "except", "minor", "slightly", "downside", "con", "pro",
    "pros", "cons", "overall", "compared", "previous", "version", "model", "color",
    "material", "plastic", "metal", "steel", "aluminum", "noise", "temperature",
    "heat", "wash", "washed", "shrink", "tight", "loose", "seal", "gasket", "firmware",
    "refund", "cord", "carafe", "cushion", "commute", "sleep", "turbo",
}

GROUNDING_CUES = {
    "i", "me", "my", "mine", "myself", "we", "our", "bought", "ordered", "received",
    "returned", "replaced", "used", "using", "tested", "testing", "noticed", "found",
    "arrived", "opened", "plugged", "washed", "wore", "tried", "contacted",
}

STOP_WORDS = {
    "a", "an", "and", "are", "as", "at", "be", "been", "being", "by", "for", "from",
    "had", "has", "have", "he", "her", "hers", "him", "his", "in", "into", "is", "it",
    "its", "of", "on", "or", "she", "that", "the", "their", "them", "they", "this",
    "to", "was", "were", "will", "with", "you", "your",
}

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
    "ai_template_score",
    "first_person_grounding",
    "lexical_diversity",
    "account_risk_score",
]

TOKEN_RE = re.compile(r"[a-z0-9']+")
RAW_TOKEN_RE = re.compile(r"[A-Za-z0-9']+")
REPEAT_PUNCT_RE = re.compile(r"([!?])\1{1,}")
NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")


def compute_account_risk(
    verified_purchase: bool,
    account_age_days: Optional[int] = None,
    reviewer_review_count: Optional[int] = None,
) -> float:
    """Estimate reviewer-account risk in [0.0, 1.0] from optional metadata."""
    if account_age_days is None and reviewer_review_count is None:
        return 0.15 if verified_purchase else 0.55

    risk = 0.25 if verified_purchase else 0.58
    if account_age_days is not None:
        if account_age_days <= 7:
            risk += 0.35
        elif account_age_days <= 30:
            risk += 0.18
        elif account_age_days >= 365:
            risk -= 0.15

    if reviewer_review_count is not None:
        if reviewer_review_count == 1 and not verified_purchase:
            risk += 0.15
        elif reviewer_review_count >= 40 and not verified_purchase:
            risk += 0.22
        elif 3 <= reviewer_review_count <= 25 and verified_purchase:
            risk -= 0.08

    return float(max(0.02, min(0.98, risk)))


def extract_behavioral_dict(
    text: str,
    rating: int,
    verified_purchase: bool,
    account_age_days: Optional[int] = None,
    reviewer_review_count: Optional[int] = None,
) -> Dict[str, float]:
    """Compute 16 deterministic behavioral & linguistic features from a review."""
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

    rating_clamped = max(1, min(5, int(rating)))
    rating_extremity = abs(rating_clamped - 3) / 2.0
    verified_num = 1.0 if verified_purchase else 0.0

    expected_polarity = (rating_clamped - 3.0) / 2.0
    rating_sentiment_mismatch = abs(expected_polarity - sentiment_polarity)

    hype_hits = sum(1 for phrase in HYPE_PHRASES if phrase in lower)
    generic_praise_density = min(hype_hits / max(word_count / 10.0, 1.0), 3.0)

    spec_hits = sum(1 for t in tokens if t in SPECIFICITY_CUES)
    num_hits = len(NUMBER_RE.findall(cleaned))
    specificity_score = min((spec_hits + 0.7 * num_hits) / max(word_count / 12.0, 1.0), 3.0)

    lexical_diversity = len(set(tokens)) / max(word_count, 1)
    repeat_punct_hits = len(REPEAT_PUNCT_RE.findall(cleaned))
    repetition_ratio = min((1.0 - lexical_diversity) + 0.25 * repeat_punct_hits, 2.0)

    ai_hits = sum(1 for phrase in AI_TEMPLATE_PHRASES if phrase in lower)
    ai_template_score = min(ai_hits / max(word_count / 18.0, 1.0), 2.5)

    ground_hits = sum(1 for t in tokens if t in GROUNDING_CUES)
    first_person_grounding = min(ground_hits / max(word_count / 10.0, 1.0), 2.5)

    account_risk_score = compute_account_risk(
        verified_purchase=verified_purchase,
        account_age_days=account_age_days,
        reviewer_review_count=reviewer_review_count,
    )

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
        "ai_template_score": round(float(ai_template_score), 4),
        "first_person_grounding": round(float(first_person_grounding), 4),
        "lexical_diversity": round(float(lexical_diversity), 4),
        "account_risk_score": round(float(account_risk_score), 4),
    }


def extract_behavioral_vector(
    text: str,
    rating: int,
    verified_purchase: bool,
    account_age_days: Optional[int] = None,
    reviewer_review_count: Optional[int] = None,
) -> np.ndarray:
    """Return ordered 1D numpy array matching FEATURE_NAMES."""
    feats = extract_behavioral_dict(
        text,
        rating,
        verified_purchase,
        account_age_days=account_age_days,
        reviewer_review_count=reviewer_review_count,
    )
    return np.array([feats[name] for name in FEATURE_NAMES], dtype=np.float64)


def compute_trigram_shingles(text: str) -> Set[str]:
    """Normalized word 3-gram shingles for real-time duplicate / campaign matching."""
    tokens = [t for t in TOKEN_RE.findall((text or "").lower()) if len(t) > 1]
    if len(tokens) < 3:
        return set(tokens)
    return {f"{tokens[i]} {tokens[i + 1]} {tokens[i + 2]}" for i in range(len(tokens) - 2)}


def jaccard_similarity(a: Set[str], b: Set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / len(a | b)


def heuristic_fake_probability(
    text: str,
    rating: int,
    verified_purchase: bool,
    account_age_days: Optional[int] = None,
    reviewer_review_count: Optional[int] = None,
) -> float:
    """Deterministic behavioral fallback probability estimator in [0.02, 0.98]."""
    f = extract_behavioral_dict(
        text,
        rating,
        verified_purchase,
        account_age_days=account_age_days,
        reviewer_review_count=reviewer_review_count,
    )
    cleaned = (text or "").strip()
    word_count = len(RAW_TOKEN_RE.findall(cleaned))

    score = -0.45
    score += 1.35 * (f["account_risk_score"] - 0.30)
    score += 1.15 * f["generic_praise_density"]
    score += 1.25 * f["ai_template_score"]
    score += 0.95 * f["exclamation_ratio"]
    score += 2.10 * max(0.0, f["caps_ratio"] - 0.15)
    score += 0.55 * f["rating_extremity"]
    score += 0.75 * max(0.0, f["rating_sentiment_mismatch"] - 0.70)
    score += 0.85 * max(0.0, f["repetition_ratio"] - 0.35)
    score -= 0.95 * f["specificity_score"]
    score -= 0.45 * f["first_person_grounding"]

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
    account_age_days: Optional[int] = None,
    reviewer_review_count: Optional[int] = None,
    stream_signals: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Build human-readable trigger words, red flags, and authenticity green flags."""
    cleaned = (text or "").strip()
    lower = cleaned.lower()
    tokens = TOKEN_RE.findall(lower)
    word_count = len(tokens)
    f = extract_behavioral_dict(
        cleaned,
        rating,
        verified_purchase,
        account_age_days=account_age_days,
        reviewer_review_count=reviewer_review_count,
    )

    red_flags: List[Dict[str, Any]] = []
    green_flags: List[Dict[str, Any]] = []

    # 1. Stream-level real-time signals (duplicate campaign & burst spike)
    if stream_signals:
        dup_sim = float(stream_signals.get("duplicate_similarity", 0.0))
        if dup_sim >= 0.50:
            matched_product = stream_signals.get("duplicate_product") or "another listing"
            red_flags.append({
                "code": "DUPLICATE_CAMPAIGN_TEXT",
                "title": f"Near-duplicate template ({round(dup_sim * 100)}% match)",
                "detail": f"Shares high n-gram overlap with a recent review on {matched_product}, indicating a copy-paste campaign.",
                "severity": "high",
            })
        if stream_signals.get("burst_spike"):
            recent_count = stream_signals.get("product_recent_count", 0)
            red_flags.append({
                "code": "BURST_VELOCITY_SPIKE",
                "title": "Coordinated product velocity spike",
                "detail": f"Product received {recent_count} rapid reviews in the active sliding window with elevated unverified extremes.",
                "severity": "high",
            })

    # 2. Verified purchase & account risk
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

    if account_age_days is not None and account_age_days <= 14:
        red_flags.append({
            "code": "NEW_ACCOUNT_ANOMALY",
            "title": f"Newly created account ({account_age_days}d old)",
            "detail": "Freshly registered accounts posting extreme ratings carry elevated astroturfing risk.",
            "severity": "high" if not verified_purchase else "medium",
        })
    elif account_age_days is not None and account_age_days >= 365 and verified_purchase:
        green_flags.append({
            "code": "ESTABLISHED_ACCOUNT",
            "title": "Established buyer profile",
            "detail": f"Account active for {account_age_days} days with confirmed order history.",
            "severity": "positive",
        })

    # 3. Excessive punctuation & shouting
    excl_count = cleaned.count("!")
    if excl_count >= 3 or REPEAT_PUNCT_RE.search(cleaned):
        red_flags.append({
            "code": "EXCESSIVE_PUNCTUATION",
            "title": "Excessive punctuation",
            "detail": f"Detected {excl_count} exclamation mark(s) or repeated punctuation typical of hype spam.",
            "severity": "high" if excl_count >= 4 else "medium",
        })

    if f["caps_ratio"] >= 0.22 and len(cleaned) >= 15:
        pct = round(f["caps_ratio"] * 100)
        red_flags.append({
            "code": "EXCESSIVE_CAPS",
            "title": "Abnormal uppercase ratio",
            "detail": f"{pct}% of alphabetic characters are capitalized, a strong promotional/rant marker.",
            "severity": "high" if f["caps_ratio"] >= 0.4 else "medium",
        })

    # 4. AI / Polished template astroturfing
    if f["ai_template_score"] >= 0.45 and f["specificity_score"] < 0.45:
        red_flags.append({
            "code": "AI_TEMPLATE_PHRASING",
            "title": "Generic AI/template phrasing",
            "detail": "Overly polished promotional clichés with minimal concrete product measurements or usage details.",
            "severity": "high",
        })

    # 5. Extreme rating with generic praise or hostility
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

    # 6. Rating vs sentiment contradiction
    if f["rating_sentiment_mismatch"] >= 1.05:
        red_flags.append({
            "code": "RATING_SENTIMENT_MISMATCH",
            "title": "Rating contradicts review tone",
            "detail": f"A {rating}-star rating does not align with the detected text polarity ({f['sentiment_polarity']:+.2f}).",
            "severity": "medium",
        })

    # 7. Very short extreme review
    if word_count < 10 and f["rating_extremity"] == 1.0:
        red_flags.append({
            "code": "SHORT_EXTREME_REVIEW",
            "title": "Very short extreme review",
            "detail": f"Only {word_count} words submitted alongside an extreme {rating}-star score.",
            "severity": "medium",
        })

    # 8. Authenticity signals (green flags)
    if f["specificity_score"] >= 0.50 and word_count >= 16:
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

    if f["first_person_grounding"] >= 0.50 and word_count >= 14:
        green_flags.append({
            "code": "GROUNDED_EXPERIENCE",
            "title": "Grounded personal usage narrative",
            "detail": "Uses direct first-person ownership and hands-on testing context.",
            "severity": "positive",
        })

    if rating in (2, 3, 4):
        green_flags.append({
            "code": "MODERATE_RATING",
            "title": "Non-extreme star rating",
            "detail": f"{rating}-star ratings are statistically much less common in coordinated fake bursts.",
            "severity": "positive",
        })

    # Combine trigger words
    seen: Set[str] = set()
    triggers: List[Dict[str, Any]] = []

    for phrase in HYPE_PHRASES:
        if phrase in lower and phrase not in seen:
            seen.add(phrase)
            triggers.append({
                "word": phrase,
                "impact": "fake",
                "category": "Promotional / Hype Phrase",
                "weight": 0.88,
            })

    for phrase in AI_TEMPLATE_PHRASES:
        if phrase in lower and phrase not in seen:
            seen.add(phrase)
            triggers.append({
                "word": phrase,
                "impact": "fake",
                "category": "AI / Template Cliché",
                "weight": 0.82,
            })

    if model_trigger_words:
        for item in model_trigger_words:
            w = item["word"]
            if w not in seen:
                seen.add(w)
                triggers.append(item)

    for t in tokens:
        if t in SPECIFICITY_CUES and t not in seen and len(triggers) < 14:
            seen.add(t)
            triggers.append({
                "word": t,
                "impact": "genuine",
                "category": "Specific Detail Cue",
                "weight": 0.48,
            })

    triggers.sort(key=lambda x: (0 if x["impact"] == "fake" else 1, -x["weight"]))
    return triggers[:12], red_flags, green_flags
