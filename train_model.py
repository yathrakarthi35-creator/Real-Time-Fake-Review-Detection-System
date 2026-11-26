"""
Train the Real-Time Fake Review Detection ML Pipeline and export BOTH:
1. api/model.joblib  (full Scikit-learn Pipeline for local inference)
2. api/model.json.gz (lightweight numpy-only artifact for Vercel Serverless <50MB)

Includes genuine reviews across 1-5 stars (including short genuine 5-star reviews
and verified 1-star defect reports) plus 5 deceptive archetypes (5-star hype,
subtle AI-polished astroturfing, competitor sabotage, short unverified spam,
and rating-sentiment mismatches).
"""

from __future__ import annotations

import gzip
import json
import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

import joblib
import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from api.features import FEATURE_NAMES, STOP_WORDS, extract_behavioral_vector

SEED = 42
random.seed(SEED)
np.random.seed(SEED)


def generate_training_dataset(n_samples: int = 6000) -> Tuple[List[str], np.ndarray, np.ndarray]:
    """Build a diverse, realistic dataset with natural boundary overlap."""
    products = [
        "wireless earbuds", "coffee maker", "running shoes", "mechanical keyboard",
        "air purifier", "standing desk", "blender", "smartwatch", "backpack",
        "portable SSD", "desk lamp", "ceramic pan", "gaming mouse", "winter jacket",
        "espresso machine", "noise-canceling headphones", "yoga mat", "power bank",
        "robot vacuum", "electric kettle", "webcam", "monitor stand",
    ]
    timeframes = [
        "3 weeks", "two months", "6 months", "about 10 days", "over a year",
        "four weeks", "nearly 2 months", "five days", "8 months", "three weeks",
        "since January", "14 days",
    ]

    genuine_positive_details = [
        "Battery lasts around 7 hours at medium volume, though the charging case feels slightly plasticky.",
        "Setup took about 15 minutes and the manual was clear; however, the power cord could be 2 feet longer.",
        "Stitching held up after four washes and the fit is true to size, except the sleeves run a bit snug.",
        "Shipping arrived in 2 days with solid packaging. Works quietly on low mode, a little noisy on turbo.",
        "Compared to my previous model, the build quality is noticeably sturdier and the buttons are responsive.",
        "Used it daily for morning prep. Easy to clean overall, although the lid gasket needs careful drying.",
        "Good value for the price point. Minor downside is the LED indicator is quite bright in a dark room.",
        "Had a small calibration issue on day one, contacted support, and they sent a replacement part promptly.",
        "Solid aluminum frame and accurate readings. Not the lightest option in its class, but very reliable so far.",
        "Performs as advertised for everyday tasks. Wish it included a USB-C cable instead of micro-USB.",
        "Comfortable enough for a 4-hour work session. The cushion took a week to break in properly.",
        "Consistent heat distribution and zero sticking after a month of cooking on medium heat.",
        "Works well for my daily 45-minute commute and pairs quickly with both my phone and laptop.",
        "Heats 1.5 liters of water in roughly 4 minutes and shuts off cleanly without dripping from the spout.",
    ]

    genuine_short_authentic = [
        "Works as expected, battery holds up for two days of normal use. No complaints.",
        "Fits nicely on my desk and feels sturdy for $45. Would buy again.",
        "Quiet motor and easy to rinse after use. Delivery was a day late though.",
        "Solid build quality, arrived well packaged and matches the product photos.",
        "Good everyday {product}. Setup took 5 minutes and everything works cleanly.",
        "Decent quality for the price. Buttons feel crisp and cable length is 6 feet.",
    ]

    genuine_negative_details = [
        "Stopped holding a charge after 3 weeks of normal use. Returning it for a refund because support never replied.",
        "The zipper jammed twice in the first week and the inner seam started fraying. Expected better for $65.",
        "Too narrow in the toe box despite ordering my usual size 10. Returned after trying them indoors for 10 minutes.",
        "Bluetooth drops every 20 minutes when paired with my laptop. Firmware update did not fix the disconnect issue.",
        "Arrived with a cracked plastic housing due to thin packaging. The motor works, but I cannot use it safely.",
        "Water tank leaks slightly from the bottom seal after 2 months. Descaling helped briefly, then it leaked again.",
        "The hinge loosened within 12 days and wobbles whenever I type fast. Sending it back under warranty.",
    ]

    genuine_openers = [
        "I have been using this {product} for {time}.",
        "Bought the {product} {time} ago for daily use.",
        "After testing this {product} for {time}, here is my honest take:",
        "Picked up this {product} to replace an older unit after {time} of research.",
        "Been testing the {product} over the past {time}.",
        "Ordered this {product} last month.",
        "",
    ]

    # Fake Archetype 1: Classic loud 5-star hype
    fake_hype_templates = [
        "BEST {PRODUCT} EVER!!! 100% recommend!! Buy this right now, you won't regret it!! 5 stars!!!",
        "OMG AMAZING!! Literally the best {product} I have ever owned!! Changed my life!! MUST BUY!!",
        "Absolute perfection! Zero flaws! Exceeded all expectations! Hands down the best {product} on the market! Five stars!",
        "STOP LOOKING AND BUY NOW!! Incredible quality, amazing product, 10/10 worth every penny!!!",
        "Wow just wow!! Life-changing {product}!! I bought five more for my whole family!! Best ever!!",
        "So good!! Amazing amazing amazing!! Do not hesitate, buy this {product} immediately!! 5 stars!!",
        "GREAT PRODUCT!! LOVE IT!! FAST SHIPPING!! BEST SELLER!! 100% RECOMMEND!!",
        "Five stars isn't enough!! Give this {product} 100 stars!! Amazing miracle product, must buy now!!",
    ]

    # Fake Archetype 2: Subtle AI-generated / LLM-polished astroturfing (no ALL CAPS!)
    fake_ai_astroturf_templates = [
        "This {product} truly exceeded my expectations in every possible way. The craftsmanship is unmatched and it seamlessly integrates into a busy lifestyle. Cannot recommend enough.",
        "I am beyond impressed with the remarkable quality of this {product}. It delivers on every promise and elevated my daily routine. Worth every single penny, look no further.",
        "An absolute delight from start to finish. This {product} stands out from the crowd with top-notch quality and effortless performance. Couldn't be happier with this must-have addition.",
        "Truly remarkable engineering and unmatched quality. This {product} transformed my experience completely and is second to none in its category. Can't recommend enough to anyone.",
        "Exceeded every expectation I had for a {product}. It is a game changer in every way and delivers phenomenal value. Without a shadow of a doubt the finest option available.",
        "If you are considering this {product}, do not hesitate. The design is sleek, the quality is unmatched, and it performs with effortless grace. Five stars all the way.",
    ]

    # Fake Archetype 3: Short low-effort bot praise
    fake_short_templates = [
        "Best {product} ever! Love it so much!",
        "Amazing product, 100% recommend to all!",
        "Perfect 5 stars! Must buy now!",
        "Awesome quality! Worth every penny!",
        "Great {product}! Best one! Buy it!",
        "Superb! Incredible! Five stars!",
        "Totally love this! Game changer!",
    ]

    # Fake Archetype 4: Competitor 1-star sabotage
    fake_sabotage_templates = [
        "TOTAL SCAM!! COMPLETE GARBAGE!! DO NOT BUY THIS {PRODUCT}!! ZERO STARS!!",
        "Worst {product} ever made!! Total ripoff!! Stay far away and run away from this seller!!",
        "TRASH!! Complete waste of money!! Awful horrible terrible junk!! Do not buy!!",
        "0 stars if I could!! Fraud seller, fake product, absolute disaster!! Worst ever!!",
        "Stay far away!! Complete garbage!! Buy the other brand instead, this one is total trash!!",
        "Awful {product}, total scam and complete waste. Do not waste your money on this fraud.",
    ]

    # Fake Archetype 5: Rating-sentiment mismatch
    fake_mismatch_templates = [
        "Terrible broken garbage, worst experience ever, total scam and complete waste.",
        "Amazing flawless product, literally the best ever, 100% recommend to everyone!",
    ]

    texts: List[str] = []
    behav_rows: List[np.ndarray] = []
    labels: List[int] = []

    half = n_samples // 2

    # Genuine Reviews (label = 0)
    for _ in range(half):
        product = random.choice(products)
        tframe = random.choice(timeframes)
        r_roll = random.random()

        if r_roll < 0.20:
            rating = random.choice([1, 2])
            detail = random.choice(genuine_negative_details)
            opener = random.choice(genuine_openers).format(product=product, time=tframe)
            text = f"{opener} {detail}".strip()
            verified = random.random() < 0.85
            age = random.randint(45, 1600)
            rev_count = random.randint(2, 30)
        elif r_roll < 0.42:
            # Short genuine 4-5 star reviews (prevents model from flagging all short positive reviews as fake)
            rating = random.choice([4, 5])
            text = random.choice(genuine_short_authentic).format(product=product)
            verified = random.random() < 0.90
            age = random.randint(30, 1400)
            rev_count = random.randint(2, 25)
        elif r_roll < 0.70:
            rating = random.choice([3, 4])
            detail = random.choice(genuine_positive_details)
            opener = random.choice(genuine_openers).format(product=product, time=tframe)
            text = f"{opener} {detail}".strip()
            verified = random.random() < 0.88
            age = random.randint(60, 1800)
            rev_count = random.randint(3, 35)
        else:
            rating = random.choice([4, 5])
            detail = random.choice(genuine_positive_details)
            opener = random.choice(genuine_openers).format(product=product, time=tframe)
            extra = random.choice([
                " Happy with how it performs day to day.",
                " Would buy it again at this price.",
                " Fits my routine nicely without any major complaints.",
                " Really pleased overall!",
                "",
            ])
            text = f"{opener} {detail}{extra}".strip()
            verified = random.random() < 0.90
            age = random.randint(60, 1800)
            rev_count = random.randint(3, 40)

        texts.append(text)
        behav_rows.append(
            extract_behavioral_vector(
                text,
                rating,
                verified,
                account_age_days=age,
                reviewer_review_count=rev_count,
            )
        )
        labels.append(0)

    # Fake / Deceptive Reviews (label = 1)
    for _ in range(n_samples - half):
        product = random.choice(products)
        archetype = random.random()

        if archetype < 0.28:
            tpl = random.choice(fake_hype_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 5
            verified = random.random() < 0.14
            age = random.randint(1, 35)
            rev_count = random.choice([1, 2, random.randint(35, 110)])
        elif archetype < 0.54:
            # Subtle AI-generated / LLM astroturfing (some verified via incentivized rebates!)
            tpl = random.choice(fake_ai_astroturf_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 5
            verified = random.random() < 0.35
            age = random.randint(2, 90)
            rev_count = random.randint(1, 60)
        elif archetype < 0.74:
            tpl = random.choice(fake_short_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 5
            verified = random.random() < 0.18
            age = random.randint(1, 45)
            rev_count = random.randint(1, 45)
        elif archetype < 0.92:
            tpl = random.choice(fake_sabotage_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 1
            verified = random.random() < 0.12
            age = random.randint(1, 30)
            rev_count = random.randint(1, 50)
        else:
            if random.random() < 0.5:
                text = fake_mismatch_templates[0]
                rating = 5
            else:
                text = fake_mismatch_templates[1]
                rating = 1
            verified = random.random() < 0.20
            age = random.randint(1, 60)
            rev_count = random.randint(1, 40)

        texts.append(text)
        behav_rows.append(
            extract_behavioral_vector(
                text,
                rating,
                verified,
                account_age_days=age,
                reviewer_review_count=rev_count,
            )
        )
        labels.append(1)

    indices = list(range(len(texts)))
    random.shuffle(indices)
    texts = [texts[i] for i in indices]
    X_behav = np.vstack([behav_rows[i] for i in indices])
    y = np.array([labels[i] for i in indices], dtype=np.int64)
    return texts, X_behav, y


def build_feature_matrix(texts: List[str], X_behav: np.ndarray) -> np.ndarray:
    combined = np.empty((len(texts), 1 + X_behav.shape[1]), dtype=object)
    combined[:, 0] = texts
    combined[:, 1:] = X_behav
    return combined


def train_and_save() -> None:
    print("Generating realistic genuine & deceptive e-commerce review dataset (n=6000)...")
    texts, X_behav, y = generate_training_dataset(n_samples=6000)

    X_all = build_feature_matrix(texts, X_behav)
    X_train, X_test, y_train, y_test = train_test_split(
        X_all, y, test_size=0.20, random_state=SEED, stratify=y
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    max_features=2000,
                    min_df=2,
                    sublinear_tf=True,
                    token_pattern=r"[a-z0-9']+",
                    stop_words=sorted(STOP_WORDS),
                    lowercase=True,
                ),
                0,
            ),
            (
                "behavioral",
                StandardScaler(),
                list(range(1, 1 + len(FEATURE_NAMES))),
            ),
        ],
        remainder="drop",
    )

    lr_pipeline = Pipeline([
        ("features", preprocessor),
        ("clf", LogisticRegression(C=1.2, max_iter=1200, class_weight="balanced", random_state=SEED)),
    ])
    lr_pipeline.fit(X_train, y_train)
    lr_preds = lr_pipeline.predict(X_test)
    lr_probs = lr_pipeline.predict_proba(X_test)[:, 1]
    lr_acc = accuracy_score(y_test, lr_preds)
    lr_auc = roc_auc_score(y_test, lr_probs)
    lr_f1 = f1_score(y_test, lr_preds)

    rf_pipeline = Pipeline([
        ("features", preprocessor),
        ("clf", RandomForestClassifier(n_estimators=120, max_depth=18, random_state=SEED, n_jobs=-1)),
    ])
    rf_pipeline.fit(X_train, y_train)
    rf_preds = rf_pipeline.predict(X_test)
    rf_probs = rf_pipeline.predict_proba(X_test)[:, 1]
    rf_acc = accuracy_score(y_test, rf_preds)
    rf_auc = roc_auc_score(y_test, rf_probs)

    print("\n=== Model Benchmark Results ===")
    print(f"Logistic Regression -> Accuracy: {lr_acc:.4f} | F1: {lr_f1:.4f} | ROC-AUC: {lr_auc:.4f}")
    print(f"Random Forest       -> Accuracy: {rf_acc:.4f} | ROC-AUC: {rf_auc:.4f}")
    print("\nClassification Report (Logistic Regression - Selected for Production):")
    print(classification_report(y_test, lr_preds, target_names=["GENUINE", "FAKE / DECEPTIVE"]))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, lr_preds))

    api_dir = Path(__file__).resolve().parent / "api"
    api_dir.mkdir(parents=True, exist_ok=True)
    trained_at = datetime.now(timezone.utc).isoformat()

    # 1. Save Scikit-learn joblib artifact
    joblib_path = api_dir / "model.joblib"
    joblib_artifact = {
        "pipeline": lr_pipeline,
        "feature_names": FEATURE_NAMES,
        "model_type": "TF-IDF + Behavioral LogisticRegression v2",
        "accuracy": round(float(lr_acc), 4),
        "roc_auc": round(float(lr_auc), 4),
        "f1_score": round(float(lr_f1), 4),
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "trained_at": trained_at,
    }
    joblib.dump(joblib_artifact, joblib_path, compress=3)

    # 2. Export zero-dependency model.json.gz for lightweight Vercel Serverless
    fitted_features = lr_pipeline.named_steps["features"]
    fitted_tfidf = fitted_features.named_transformers_["tfidf"]
    fitted_scaler = fitted_features.named_transformers_["behavioral"]
    fitted_clf = lr_pipeline.named_steps["clf"]

    vocab_sorted = {tok: int(idx) for tok, idx in sorted(fitted_tfidf.vocabulary_.items(), key=lambda kv: kv[1])}
    json_gz_path = api_dir / "model.json.gz"
    json_bundle = {
        "model_type": "TF-IDF + Behavioral LogisticRegression v2 (Pre-Trained)",
        "vocab": vocab_sorted,
        "idf": [round(float(x), 6) for x in fitted_tfidf.idf_],
        "behav_mean": [round(float(x), 6) for x in fitted_scaler.mean_],
        "behav_std": [round(float(x), 6) for x in fitted_scaler.scale_],
        "weights": [round(float(x), 6) for x in fitted_clf.coef_[0]],
        "bias": round(float(fitted_clf.intercept_[0]), 6),
        "feature_names": FEATURE_NAMES,
        "accuracy": round(float(lr_acc), 4),
        "roc_auc": round(float(lr_auc), 4),
        "f1_score": round(float(lr_f1), 4),
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "trained_at": trained_at,
    }
    with gzip.open(json_gz_path, "wt", encoding="utf-8") as gz:
        json.dump(json_bundle, gz, separators=(",", ":"))

    print(f"\nSaved joblib model:  {joblib_path} ({os.path.getsize(joblib_path) / 1024:.1f} KB)")
    print(f"Saved json.gz model: {json_gz_path} ({os.path.getsize(json_gz_path) / 1024:.1f} KB)")


if __name__ == "__main__":
    train_and_save()
