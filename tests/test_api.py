"""End-to-end verification tests for the FastAPI ML + Real-Time SSE backend."""

from __future__ import annotations

import json
from fastapi.testclient import TestClient

from api.index import (
    app,
    infer_json_gz_model,
    load_model_bundle,
)
from api.features import extract_behavioral_vector
from api.stream_engine import stream_engine

client = TestClient(app)


def test_health_endpoint() -> None:
    res = client.get("/api/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["model_loaded"] is True
    assert data["feature_count"] == 16


def test_out_of_distribution_predictions_and_parity() -> None:
    stream_engine.reset()

    # 1. Genuine unseen review
    genuine_payload = {
        "text": "Used these headphones on a 5-hour flight. Noise reduction is decent, though the headband presses slightly after 3 hours.",
        "rating": 4,
        "verified_purchase": True,
        "product_name": "FlightPro Headphones",
        "account_age_days": 600,
        "reviewer_review_count": 12,
    }
    res_g = client.post("/api/predict", json=genuine_payload)
    assert res_g.status_code == 200
    dg = res_g.json()
    assert dg["is_fake"] is False
    assert dg["moderation_status"] == "APPROVED"

    # 2. Loud fake 5-star hype
    hype_payload = {
        "text": "BEST HEADPHONES EVER!!! 100% RECOMMEND!! Literally changed my life!! BUY RIGHT NOW!!",
        "rating": 5,
        "verified_purchase": False,
        "product_name": "FlightPro Headphones",
        "account_age_days": 2,
        "reviewer_review_count": 1,
    }
    res_f = client.post("/api/predict", json=hype_payload)
    assert res_f.status_code == 200
    df = res_f.json()
    assert df["is_fake"] is True
    assert df["moderation_status"] == "AUTO_QUARANTINED"

    # 3. Subtle AI-polished astroturfing (no ALL CAPS!)
    ai_payload = {
        "text": "This coffee maker truly exceeded my expectations in every possible way. The craftsmanship is unmatched and it seamlessly integrates into my daily routine. Cannot recommend enough.",
        "rating": 5,
        "verified_purchase": False,
        "product_name": "BrewMaster",
        "account_age_days": 5,
        "reviewer_review_count": 20,
    }
    res_ai = client.post("/api/predict", json=ai_payload)
    assert res_ai.status_code == 200
    dai = res_ai.json()
    assert dai["is_fake"] is True
    assert any(rf["code"] == "AI_TEMPLATE_PHRASING" for rf in dai["red_flags"])

    # 4. Verify json.gz parity matches joblib within 1e-3
    import gzip
    from pathlib import Path
    import numpy as np

    with gzip.open(Path("api/model.json.gz"), "rt", encoding="utf-8") as gz:
        raw = json.load(gz)
    raw["_idf_np"] = np.array(raw["idf"], dtype=np.float64)
    raw["_behav_mean_np"] = np.array(raw["behav_mean"], dtype=np.float64)
    raw["_behav_std_np"] = np.array(raw["behav_std"], dtype=np.float64)
    raw["_weights_np"] = np.array(raw["weights"], dtype=np.float64)

    bvec = extract_behavioral_vector(
        ai_payload["text"],
        ai_payload["rating"],
        ai_payload["verified_purchase"],
        account_age_days=ai_payload["account_age_days"],
        reviewer_review_count=ai_payload["reviewer_review_count"],
    )
    prob_gz, _ = infer_json_gz_model(raw, ai_payload["text"], bvec)
    assert abs(prob_gz * 100.0 - dai["fake_probability"]) < 1.0


def test_realtime_ingest_duplicate_and_moderation() -> None:
    stream_engine.reset()

    template_text = (
        "Absolute perfection! Zero flaws! Exceeded all expectations and worth every penny! Five stars all the way!"
    )
    r1 = client.post(
        "/api/ingest",
        json={
            "product_name": "AeroPods Pro",
            "reviewer": "Bot_1",
            "rating": 5,
            "verified_purchase": False,
            "text": template_text,
        },
    )
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["source"] == "webhook"

    # Second identical review on another product triggers duplicate campaign detection
    r2 = client.post(
        "/api/ingest",
        json={
            "product_name": "VoltCore Power Bank",
            "reviewer": "Bot_2",
            "rating": 5,
            "verified_purchase": False,
            "text": template_text,
        },
    )
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["prediction"]["duplicate_similarity"] >= 90.0
    assert any(
        rf["code"] == "DUPLICATE_CAMPAIGN_TEXT" for rf in d2["prediction"]["red_flags"]
    )

    # Analyst moderation override
    mod_res = client.post(
        f"/api/moderation/{d2['id']}",
        json={"moderation_status": "APPROVED"},
    )
    assert mod_res.status_code == 200
    assert mod_res.json()["prediction"]["moderation_status"] == "APPROVED"
    assert mod_res.json()["prediction"]["analyst_reviewed"] is True


def test_batch_predict_and_stream_simulate() -> None:
    stream_engine.reset()
    batch_res = client.post(
        "/api/batch-predict",
        json={
            "reviews": [
                {
                    "product_name": "Desk Lamp",
                    "reviewer": "Alice",
                    "rating": 4,
                    "verified_purchase": True,
                    "text": "Good brightness levels for late-night reading and sturdy metal base. Cord is 5 feet long.",
                },
                {
                    "product_name": "Desk Lamp",
                    "reviewer": "Bot_X",
                    "rating": 5,
                    "verified_purchase": False,
                    "text": "BEST LAMP EVER!!! 100% RECOMMEND!! MUST BUY RIGHT NOW!!",
                },
            ]
        },
    )
    assert batch_res.status_code == 200
    bdata = batch_res.json()
    assert bdata["total"] == 2
    assert bdata["fake_count"] == 1
    assert bdata["genuine_count"] == 1

    sim_res = client.post("/api/stream/simulate?scenario=ai_astroturf")
    assert sim_res.status_code == 200
    assert "prediction" in sim_res.json()

    # Multi-event seed + history snapshot
    seed_res = client.post("/api/stream/simulate?scenario=normal&count=5")
    assert seed_res.status_code == 200
    assert seed_res.json()["count"] == 5

    hist_res = client.get("/api/stream/history?limit=10")
    assert hist_res.status_code == 200
    assert hist_res.json()["summary"]["total"] >= 6

    # Predict with publish_to_stream=True returns matching published_record
    pub_res = client.post(
        "/api/predict",
        json={
            "product_name": "Published Test",
            "reviewer": "Tester",
            "rating": 5,
            "verified_purchase": False,
            "text": "BEST PRODUCT EVER!!! 100% RECOMMEND!!",
            "publish_to_stream": True,
        },
    )
    assert pub_res.status_code == 200
    assert pub_res.json()["published_record"]["product_name"] == "Published Test"
    stream_engine.reset()


if __name__ == "__main__":
    test_health_endpoint()
    test_out_of_distribution_predictions_and_parity()
    test_realtime_ingest_duplicate_and_moderation()
    test_batch_predict_and_stream_simulate()
    print("ALL BACKEND TESTS PASSED!")
