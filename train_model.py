"""
Train the Real-Time Fake Review Detection ML Pipeline and save api/model.joblib.

Architecture:
- Text features: TF-IDF (1-2 ngrams, 3500 max features, sublinear TF)
- Behavioral features: 12 engineered signals (sentiment polarity, subjectivity,
  exclamation ratio, caps ratio, log length, rating extremity, verified purchase,
  rating-sentiment mismatch, hype phrase density, specificity score, repetition)
- Classifier: Logistic Regression (and Random Forest benchmark comparison)
- Bundle target: < 1MB compressed joblib artifact, < 50MB total Vercel Python runtime.
"""

from __future__ import annotations

import os
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Tuple

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
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from api.features import FEATURE_NAMES, extract_behavioral_vector

SEED = 42
random.seed(SEED)
np.random.seed(SEED)


def generate_synthetic_dataset(n_samples: int = 2600) -> Tuple[List[str], np.ndarray, np.ndarray]:
    """
    Build a rich, diverse dataset of genuine (label=0) and fake/deceptive (label=1)
    e-commerce reviews across multiple product categories and deception archetypes.
    """
    products = [
        "wireless earbuds", "coffee maker", "running shoes", "mechanical keyboard",
        "air purifier", "standing desk", "blender", "smartwatch", "backpack",
        "portable SSD", "desk lamp", "ceramic pan", "gaming mouse", "winter jacket",
        "espresso machine", "noise-canceling headphones", "yoga mat", "power bank",
    ]
    timeframes = [
        "3 weeks", "two months", "6 months", "about 10 days", "over a year",
        "four weeks", "nearly 2 months", "five days", "8 months", "three weeks",
    ]
    genuine_details = [
        "Battery lasts around 7 hours at medium volume, though the charging case feels slightly plasticky.",
        "Setup took about 15 minutes and the manual was clear; however, the power cord could be 2 feet longer.",
        "Stitching held up after four washes and the fit is true to size, except the sleeves run a bit snug.",
        "Shipping arrived in 2 days with solid packaging. Works quietly on low mode, a little noisy on turbo.",
        "Compared to my previous model, the build quality is noticeably sturdier and the buttons are responsive.",
        "Used it daily for morning prep. Easy to clean overall, although the lid gasket needs careful drying.",
        "Good value for the price point. Minor downside is the LED indicator is quite bright in a dark room.",
        "Had a small calibration issue on day one, contacted support, and they sent a replacement part promptly.",
        "Solid metal frame and accurate readings. Not the lightest option in its class, but very reliable so far.",
        "Performs as advertised for everyday tasks. Wish it included a USB-C cable instead of micro-USB.",
        "Comfortable enough for a 4-hour work session. The cushion took a week to break in properly.",
        "Consistent heat distribution and zero sticking after a month of cooking on medium heat.",
    ]
    genuine_negative_details = [
        "Stopped holding a charge after 3 weeks of normal use. Returning it for a refund because support never replied.",
        "The zipper jammed twice in the first week and the inner seam started fraying. Expected better for $65.",
        "Too narrow in the toe box despite ordering my usual size 10. Returned after trying them indoors for 10 minutes.",
        "Bluetooth drops every 20 minutes when paired with my laptop. Firmware update did not fix the disconnect issue.",
        "Arrived with a cracked plastic housing due to thin packaging. The motor works, but I cannot use it safely.",
        "Water tank leaks slightly from the bottom seal after 2 months. Descaling helped briefly, then it leaked again.",
    ]
    genuine_openers = [
        "I have been using this {product} for {time}.",
        "Bought the {product} {time} ago for daily use.",
        "After testing this {product} for {time}, here is my honest take:",
        "Picked up this {product} to replace an older unit after {time} of research.",
        "Been testing the {product} over the past {time}.",
        "Ordered this {product} last month.",
    ]

    # Fake Archetype 1: Generic 5-star hype / astroturfing
    fake_hype_templates = [
        "BEST {PRODUCT} EVER!!! 100% recommend!! Buy this right now, you won't regret it!! 5 stars!!!",
        "OMG AMAZING!! Literally the best {product} I have ever owned!! Changed my life!! MUST BUY!!",
        "Absolute perfection! Zero flaws! Exceeded all expectations! Hands down the best {product} on the market! Five stars!",
        "STOP LOOKING AND BUY NOW!! Incredible quality, amazing product, 10/10 worth every penny!!!",
        "Wow just wow!! Life-changing {product}!! I bought five more for my whole family!! Best ever!!",
        "So good!! Amazing amazing amazing!! Do not hesitate, buy this {product} immediately!! 5 stars!!",
        "Unbelievable!! Pure genius!! Flawless quality and phenomenal everything!! Highly recommend to everyone!!!",
        "Best purchase of my entire life! Literally obsessed with this {product}! Game changer! 10/10!",
        "GREAT PRODUCT!! LOVE IT!! FAST SHIPPING!! BEST SELLER!! 100% RECOMMEND!!",
        "Five stars isn't enough!! Give this {product} 100 stars!! Amazing miracle product, must buy now!!",
    ]

    # Fake Archetype 2: Short, vague unverified praise
    fake_short_templates = [
        "Best {product} ever! Love it so much!",
        "Amazing product, 100% recommend to all!",
        "Perfect 5 stars! Must buy now!",
        "Awesome quality! Worth every penny!",
        "Great {product}! Best one! Buy it!",
        "Superb! Incredible! Five stars!",
        "Totally love this! Game changer!",
    ]

    # Fake Archetype 3: Competitor 1-star sabotage (generic rage, no real usage details)
    fake_sabotage_templates = [
        "TOTAL SCAM!! COMPLETE GARBAGE!! DO NOT BUY THIS {PRODUCT}!! ZERO STARS!!",
        "Worst {product} ever made!! Total ripoff!! Stay far away and run away from this seller!!",
        "TRASH!! Complete waste of money!! Awful horrible terrible junk!! Do not buy!!",
        "0 stars if I could!! Fraud seller, fake product, absolute disaster!! Worst ever!!",
        "Stay far away!! Complete garbage!! Buy the other brand instead, this one is total trash!!",
    ]

    # Fake Archetype 4: Rating-sentiment mismatch / bot copy-paste glitches
    fake_mismatch_templates = [
        "Terrible broken garbage, worst experience ever, total scam and complete waste.",
        "Amazing flawless product, literally the best ever, 100% recommend to everyone!",
    ]

    texts: List[str] = []
    behav_rows: List[np.ndarray] = []
    labels: List[int] = []

    half = n_samples // 2

    # Generate Genuine Reviews (label = 0)
    for i in range(half):
        product = random.choice(products)
        time = random.choice(timeframes)
        r_roll = random.random()

        if r_roll < 0.22:
            # Genuine negative (1-2 stars, detailed defect)
            rating = random.choice([1, 2])
            detail = random.choice(genuine_negative_details)
            opener = random.choice(genuine_openers).format(product=product, time=time)
            text = f"{opener} {detail}"
            verified = random.random() < 0.88
        elif r_roll < 0.55:
            # Genuine moderate (3-4 stars, balanced)
            rating = random.choice([3, 4])
            detail = random.choice(genuine_details)
            opener = random.choice(genuine_openers).format(product=product, time=time)
            text = f"{opener} {detail}"
            verified = random.random() < 0.90
        else:
            # Genuine positive (4-5 stars, specific & grounded)
            rating = random.choice([4, 5])
            detail = random.choice(genuine_details)
            opener = random.choice(genuine_openers).format(product=product, time=time)
            extra = random.choice([
                " Happy with how it performs day to day.",
                " Would buy it again at this price.",
                " Fits my routine nicely without any major complaints.",
                "",
            ])
            text = f"{opener} {detail}{extra}"
            verified = random.random() < 0.92

        texts.append(text)
        behav_rows.append(extract_behavioral_vector(text, rating, verified))
        labels.append(0)

    # Generate Fake / Deceptive Reviews (label = 1)
    for i in range(n_samples - half):
        product = random.choice(products)
        archetype = random.random()

        if archetype < 0.45:
            tpl = random.choice(fake_hype_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 5
            verified = random.random() < 0.14
        elif archetype < 0.70:
            tpl = random.choice(fake_short_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 5
            verified = random.random() < 0.18
        elif archetype < 0.90:
            tpl = random.choice(fake_sabotage_templates)
            text = tpl.format(product=product, PRODUCT=product.upper())
            rating = 1
            verified = random.random() < 0.12
        else:
            # Rating-text mismatch
            if random.random() < 0.5:
                text = fake_mismatch_templates[0]
                rating = 5
            else:
                text = fake_mismatch_templates[1]
                rating = 1
            verified = random.random() < 0.20

        texts.append(text)
        behav_rows.append(extract_behavioral_vector(text, rating, verified))
        labels.append(1)

    # Shuffle deterministically
    indices = list(range(len(texts)))
    random.shuffle(indices)
    texts = [texts[i] for i in indices]
    X_behav = np.vstack([behav_rows[i] for i in indices])
    y = np.array([labels[i] for i in indices], dtype=np.int64)
    return texts, X_behav, y


def build_feature_matrix_dict(texts: List[str], X_behav: np.ndarray) -> Dict[str, np.ndarray]:
    """Pack text + behavioral matrix into a lightweight dict for ColumnTransformer."""
    # Using a 2D object array avoids requiring pandas in requirements.txt (saves ~45MB on Vercel!)
    combined = np.empty((len(texts), 1 + X_behav.shape[1]), dtype=object)
    combined[:, 0] = texts
    combined[:, 1:] = X_behav
    return combined


def train_and_save() -> None:
    print("Generating realistic genuine & deceptive e-commerce review dataset...")
    texts, X_behav, y = generate_synthetic_dataset(n_samples=2600)

    X_all = build_feature_matrix_dict(texts, X_behav)
    X_train, X_test, y_train, y_test = train_test_split(
        X_all, y, test_size=0.20, random_state=SEED, stratify=y
    )

    preprocessor = ColumnTransformer(
        transformers=[
            (
                "tfidf",
                TfidfVectorizer(
                    ngram_range=(1, 2),
                    max_features=3500,
                    sublinear_tf=True,
                    stop_words="english",
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

    # Candidate 1: Logistic Regression (fast, interpretable TF-IDF coefficients, tiny size)
    lr_pipeline = Pipeline([
        ("features", preprocessor),
        ("clf", LogisticRegression(C=1.5, max_iter=1000, class_weight="balanced", random_state=SEED)),
    ])
    lr_pipeline.fit(X_train, y_train)
    lr_preds = lr_pipeline.predict(X_test)
    lr_probs = lr_pipeline.predict_proba(X_test)[:, 1]
    lr_acc = accuracy_score(y_test, lr_preds)
    lr_auc = roc_auc_score(y_test, lr_probs)

    # Candidate 2: Random Forest benchmark
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
    print(f"Logistic Regression -> Accuracy: {lr_acc:.4f} | ROC-AUC: {lr_auc:.4f}")
    print(f"Random Forest       -> Accuracy: {rf_acc:.4f} | ROC-AUC: {rf_auc:.4f}")
    print("\nClassification Report (Logistic Regression - Selected for Production):")
    print(classification_report(y_test, lr_preds, target_names=["GENUINE", "FAKE / DECEPTIVE"]))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, lr_preds))

    # Persist model + metadata bundle inside /api/model.joblib
    out_path = Path(__file__).resolve().parent / "api" / "model.joblib"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    artifact = {
        "pipeline": lr_pipeline,
        "feature_names": FEATURE_NAMES,
        "model_type": "TF-IDF + Behavioral LogisticRegression",
        "accuracy": round(float(lr_acc), 4),
        "roc_auc": round(float(lr_auc), 4),
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    joblib.dump(artifact, out_path, compress=3)
    size_kb = os.path.getsize(out_path) / 1024.0
    print(f"\nSaved production model to: {out_path}")
    print(f"Model bundle size: {size_kb:.1f} KB (well within Vercel 250MB limit)")


if __name__ == "__main__":
    train_and_save()
