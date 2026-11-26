"""
Real-Time Stream Intelligence, Cross-Review Anomaly Engine & SSE Event Bus.
Tracks sliding-window duplicates, product burst velocity, product trust-adjusted
ratings, moderation queue state, and live Server-Sent Events (SSE) subscribers.
"""

from __future__ import annotations

import asyncio
import json
import random
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Set, Tuple

try:
    from api.features import compute_trigram_shingles, jaccard_similarity
except ImportError:
    from features import compute_trigram_shingles, jaccard_similarity  # type: ignore

MAX_BUFFER_SIZE = 500
MAX_SHINGLE_WINDOW = 200
BURST_WINDOW_SECONDS = 60.0

# ---------------------------------------------------------------------------
# Realistic Scenario Pools for Live Stream Simulation
# ---------------------------------------------------------------------------
GENUINE_POOL = [
    {
        "product_name": "AeroPods Pro ANC Earbuds",
        "reviewer": "Priya M.",
        "rating": 4,
        "verified_purchase": True,
        "account_age_days": 840,
        "reviewer_review_count": 14,
        "text": "Used these earbuds on my daily 45-minute commute for 3 weeks. Noise cancellation blocks bus rumble well, though the silicone tips took a couple days to feel comfortable.",
    },
    {
        "product_name": "BrewMaster Drip Coffee Maker",
        "reviewer": "Daniel K.",
        "rating": 5,
        "verified_purchase": True,
        "account_age_days": 1120,
        "reviewer_review_count": 21,
        "text": "Brewing takes about 6 minutes for a full 10-cup carafe and the thermal pot keeps coffee hot for 2 hours. Minor downside is the water reservoir markings are hard to read in dim light.",
    },
    {
        "product_name": "KeyForge TKL Mechanical Keyboard",
        "reviewer": "Arjun S.",
        "rating": 4,
        "verified_purchase": True,
        "account_age_days": 510,
        "reviewer_review_count": 9,
        "text": "Solid aluminum plate and crisp tactile switches right out of the box. Shipping arrived in 2 days with good packaging. Wish the detachable USB-C cable were braided.",
    },
    {
        "product_name": "PureAir HEPA-13 Purifier",
        "reviewer": "Elena R.",
        "rating": 3,
        "verified_purchase": True,
        "account_age_days": 670,
        "reviewer_review_count": 12,
        "text": "Works quietly on sleep mode and noticeably reduced dust in our bedroom over the past month. However, replacement filters cost $38 each which adds up quickly.",
    },
    {
        "product_name": "TrailStride Running Shoes",
        "reviewer": "Marcus T.",
        "rating": 2,
        "verified_purchase": True,
        "account_age_days": 950,
        "reviewer_review_count": 17,
        "text": "Cushioning felt fine on my first two 5km runs, but the toe box runs half a size narrow and caused blisters by week two. Returned them for a wider model.",
    },
    {
        "product_name": "VoltCore 20000mAh Power Bank",
        "reviewer": "Sneha V.",
        "rating": 5,
        "verified_purchase": True,
        "account_age_days": 430,
        "reviewer_review_count": 8,
        "text": "Charged my phone three full times during a weekend train trip with 20% battery remaining. A bit heavier than my older 10000mAh unit, but the 45W USB-C output is reliable.",
    },
    {
        "product_name": "ChefCraft Ceramic Frying Pan",
        "reviewer": "Liam W.",
        "rating": 4,
        "verified_purchase": True,
        "account_age_days": 780,
        "reviewer_review_count": 11,
        "text": "Even heat distribution on our induction stove and eggs slide right off after 6 weeks of use. Hand-washing only is slightly inconvenient, yet overall great value.",
    },
]

HYPE_BURST_POOL = [
    {
        "product_name": "AeroPods Pro ANC Earbuds",
        "reviewer": "DealHunter992",
        "rating": 5,
        "verified_purchase": False,
        "account_age_days": 3,
        "reviewer_review_count": 1,
        "text": "BEST EARBUDS EVER!!! 100% RECOMMEND!! Literally changed my life!! BUY THIS RIGHT NOW!! 5 STARS!!!",
    },
    {
        "product_name": "VoltCore 20000mAh Power Bank",
        "reviewer": "FastReview2026",
        "rating": 5,
        "verified_purchase": False,
        "account_age_days": 2,
        "reviewer_review_count": 48,
        "text": "OMG AMAZING!! Best product ever!! Worth every penny!! Stop looking and buy now!! 10/10 game changer!!!",
    },
    {
        "product_name": "KeyForge TKL Mechanical Keyboard",
        "reviewer": "GuestUser77",
        "rating": 5,
        "verified_purchase": False,
        "account_age_days": 5,
        "reviewer_review_count": 2,
        "text": "Superb! Incredible! Five stars! Love it so much! Best keyboard ever!",
    },
    {
        "product_name": "BrewMaster Drip Coffee Maker",
        "reviewer": "Shopper_X81",
        "rating": 5,
        "verified_purchase": False,
        "account_age_days": 4,
        "reviewer_review_count": 62,
        "text": "Absolute perfection! Zero flaws! Exceeded all expectations! Hands down the best coffee maker on the market! Must buy!",
    },
]

AI_ASTROTURF_POOL = [
    {
        "product_name": "AeroPods Pro ANC Earbuds",
        "reviewer": "Clara_B91",
        "rating": 5,
        "verified_purchase": False,
        "account_age_days": 9,
        "reviewer_review_count": 19,
        "text": "These earbuds truly exceeded my expectations in every possible way. The craftsmanship is unmatched and they seamlessly integrate into a busy lifestyle. Cannot recommend enough.",
    },
    {
        "product_name": "PureAir HEPA-13 Purifier",
        "reviewer": "Verified_Style_24",
        "rating": 5,
        "verified_purchase": True,
        "account_age_days": 11,
        "reviewer_review_count": 37,
        "text": "I am beyond impressed with the remarkable quality of this purifier. It delivers on every promise and elevated my daily routine. Worth every single penny, look no further.",
    },
    {
        "product_name": "BrewMaster Drip Coffee Maker",
        "reviewer": "HomeLuxe_99",
        "rating": 5,
        "verified_purchase": False,
        "account_age_days": 6,
        "reviewer_review_count": 28,
        "text": "An absolute delight from start to finish. This coffee maker stands out from the crowd with top-notch quality and effortless performance. Couldn't be happier with this must-have addition.",
    },
]

SABOTAGE_POOL = [
    {
        "product_name": "PureAir HEPA-13 Purifier",
        "reviewer": "PromoBot_44",
        "rating": 1,
        "verified_purchase": False,
        "account_age_days": 2,
        "reviewer_review_count": 1,
        "text": "TOTAL SCAM!! COMPLETE GARBAGE!! DO NOT BUY THIS!! Stay far away and run away from this fraud seller!! ZERO STARS!!",
    },
    {
        "product_name": "TrailStride Running Shoes",
        "reviewer": "Anonymous_904",
        "rating": 1,
        "verified_purchase": False,
        "account_age_days": 4,
        "reviewer_review_count": 43,
        "text": "TRASH!! Complete waste of money!! Awful horrible terrible junk!! Worst ever!! Do not buy!!",
    },
    {
        "product_name": "ChefCraft Ceramic Frying Pan",
        "reviewer": "AngryBuyer_09",
        "rating": 1,
        "verified_purchase": False,
        "account_age_days": 1,
        "reviewer_review_count": 1,
        "text": "0 stars if I could!! Fraud seller, fake product, absolute disaster!! Buy the other brand instead!!",
    },
]

DUPLICATE_BOTNET_TEMPLATES = [
    "Absolute perfection! Zero flaws! Exceeded all expectations and worth every penny! Five stars all the way!",
    "Truly remarkable engineering and unmatched quality! Transformed my experience completely and cannot recommend enough!",
]


class RealTimeStreamEngine:
    """Thread-safe sliding window & SSE broadcaster for live fake review detection."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._records: Deque[Dict[str, Any]] = deque(maxlen=MAX_BUFFER_SIZE)
        self._shingles: Deque[Tuple[str, str, Set[str]]] = deque(maxlen=MAX_SHINGLE_WINDOW)
        # product_name -> deque of (epoch_sec, is_fake, verified_purchase, rating)
        self._product_events: Dict[str, Deque[Tuple[float, bool, bool, int]]] = defaultdict(
            lambda: deque(maxlen=100)
        )
        # SSE subscribers: set of (event_loop, asyncio.Queue)
        self._subscribers: Set[Tuple[asyncio.AbstractEventLoop, asyncio.Queue[Dict[str, Any]]]] = set()

    def subscribe(self, loop: asyncio.AbstractEventLoop) -> asyncio.Queue[Dict[str, Any]]:
        q: asyncio.Queue[Dict[str, Any]] = asyncio.Queue(maxsize=100)
        with self._lock:
            self._subscribers.add((loop, q))
        return q

    def unsubscribe(self, loop: asyncio.AbstractEventLoop, q: asyncio.Queue[Dict[str, Any]]) -> None:
        with self._lock:
            self._subscribers.discard((loop, q))

    def subscriber_count(self) -> int:
        with self._lock:
            return len(self._subscribers)

    def _broadcast(self, event_type: str, payload: Any) -> None:
        msg = {"type": event_type, "data": payload}
        with self._lock:
            subs = list(self._subscribers)

        stale: List[Tuple[asyncio.AbstractEventLoop, asyncio.Queue[Dict[str, Any]]]] = []
        for loop, q in subs:
            if loop.is_closed():
                stale.append((loop, q))
                continue
            try:
                def _push(queue: asyncio.Queue[Dict[str, Any]] = q, item: Dict[str, Any] = msg) -> None:
                    if queue.full():
                        try:
                            queue.get_nowait()
                        except asyncio.QueueEmpty:
                            pass
                    try:
                        queue.put_nowait(item)
                    except asyncio.QueueFull:
                        pass

                loop.call_soon_threadsafe(_push)
            except Exception:
                stale.append((loop, q))

        if stale:
            with self._lock:
                for s in stale:
                    self._subscribers.discard(s)

    def inspect_context(self, text: str, product_name: str) -> Dict[str, Any]:
        """Check sliding window for near-duplicate text and product burst velocity."""
        now = time.time()
        shingles = compute_trigram_shingles(text)
        best_sim = 0.0
        matched_product: Optional[str] = None
        matched_id: Optional[str] = None

        with self._lock:
            for rec_id, rec_product, rec_shingles in self._shingles:
                sim = jaccard_similarity(shingles, rec_shingles)
                if sim > best_sim:
                    best_sim = sim
                    matched_product = rec_product
                    matched_id = rec_id

            events = self._product_events[product_name]
            while events and (now - events[0][0]) > BURST_WINDOW_SECONDS:
                events.popleft()
            recent_count = len(events)
            recent_unverified_extreme = sum(
                1 for _, _, ver, rat in events if (not ver and rat in (1, 5))
            )
            burst_spike = recent_count >= 4 and (
                recent_unverified_extreme / max(recent_count, 1) >= 0.5
            )

        return {
            "duplicate_similarity": round(float(best_sim), 4),
            "duplicate_product": matched_product,
            "duplicate_review_id": matched_id,
            "product_recent_count": recent_count,
            "burst_spike": burst_spike,
        }

    def record_and_broadcast(self, record: Dict[str, Any]) -> Dict[str, Any]:
        """Persist classified review into sliding window and push SSE event."""
        now = time.time()
        shingles = compute_trigram_shingles(record["text"])
        pred = record["prediction"]

        with self._lock:
            self._records.appendleft(record)
            self._shingles.appendleft((record["id"], record["product_name"], shingles))
            self._product_events[record["product_name"]].append(
                (now, bool(pred["is_fake"]), bool(record["verified_purchase"]), int(record["rating"]))
            )

        self._broadcast("review", record)
        return record

    def update_moderation(self, review_id: str, moderation_status: str) -> Optional[Dict[str, Any]]:
        updated: Optional[Dict[str, Any]] = None
        with self._lock:
            for rec in self._records:
                if rec["id"] == review_id:
                    rec["prediction"]["moderation_status"] = moderation_status
                    rec["prediction"]["analyst_reviewed"] = True
                    updated = rec
                    break
        if updated is not None:
            self._broadcast("moderation", updated)
        return updated

    def reset(self) -> None:
        with self._lock:
            self._records.clear()
            self._shingles.clear()
            self._product_events.clear()
        self._broadcast("reset", {"timestamp": datetime.now(timezone.utc).isoformat()})

    def get_snapshot(self, limit: int = 100) -> Dict[str, Any]:
        with self._lock:
            records = list(self._records)[:limit]
            all_records = list(self._records)

        total = len(all_records)
        fake_count = sum(1 for r in all_records if r["prediction"]["is_fake"])
        quarantined_count = sum(
            1
            for r in all_records
            if r["prediction"].get("moderation_status") == "AUTO_QUARANTINED"
        )
        avg_latency = (
            round(sum(r["prediction"]["latency_ms"] for r in all_records) / total, 2)
            if total
            else 0.0
        )

        # Product risk breakdown
        by_product: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for r in all_records:
            by_product[r["product_name"]].append(r)

        leaderboard = []
        for pname, items in by_product.items():
            cnt = len(items)
            f_cnt = sum(1 for x in items if x["prediction"]["is_fake"])
            q_cnt = sum(
                1
                for x in items
                if x["prediction"].get("moderation_status") == "AUTO_QUARANTINED"
            )
            raw_avg = sum(x["rating"] for x in items) / cnt
            genuine_items = [x for x in items if not x["prediction"]["is_fake"]]
            adjusted_avg = (
                sum(x["rating"] for x in genuine_items) / len(genuine_items)
                if genuine_items
                else raw_avg
            )
            fake_rate = (f_cnt / cnt) * 100.0
            leaderboard.append({
                "product_name": pname,
                "total_reviews": cnt,
                "fake_count": f_cnt,
                "quarantined_count": q_cnt,
                "fake_rate": round(fake_rate, 1),
                "raw_avg_rating": round(raw_avg, 2),
                "trust_adjusted_rating": round(adjusted_avg, 2),
                "under_attack": cnt >= 3 and fake_rate >= 55.0,
            })

        leaderboard.sort(key=lambda x: (-x["fake_rate"], -x["total_reviews"]))

        return {
            "records": records,
            "summary": {
                "total": total,
                "fake_count": fake_count,
                "genuine_count": total - fake_count,
                "quarantined_count": quarantined_count,
                "fake_rate": round((fake_count / total) * 100.0, 1) if total else 0.0,
                "avg_latency_ms": avg_latency,
            },
            "product_leaderboard": leaderboard[:10],
        }

    def pick_scenario_sample(self, scenario: str = "normal") -> Dict[str, Any]:
        if scenario == "hype_burst":
            pick_fake = random.random() < 0.88
            return dict(random.choice(HYPE_BURST_POOL if pick_fake else GENUINE_POOL))
        if scenario == "ai_astroturf":
            pick_fake = random.random() < 0.85
            return dict(random.choice(AI_ASTROTURF_POOL if pick_fake else GENUINE_POOL))
        if scenario == "competitor_sabotage":
            pick_fake = random.random() < 0.85
            return dict(random.choice(SABOTAGE_POOL if pick_fake else GENUINE_POOL))
        if scenario == "duplicate_botnet":
            if random.random() < 0.85:
                return {
                    "product_name": random.choice([
                        "AeroPods Pro ANC Earbuds",
                        "VoltCore 20000mAh Power Bank",
                        "KeyForge TKL Mechanical Keyboard",
                    ]),
                    "reviewer": f"BotNode_{random.randint(100, 999)}",
                    "rating": 5,
                    "verified_purchase": False,
                    "account_age_days": random.randint(1, 5),
                    "reviewer_review_count": random.randint(1, 3),
                    "text": random.choice(DUPLICATE_BOTNET_TEMPLATES),
                }
            return dict(random.choice(GENUINE_POOL))

        # Default "normal": realistic mix of genuine (~65%) and varied deception (~35%)
        roll = random.random()
        if roll < 0.65:
            return dict(random.choice(GENUINE_POOL))
        if roll < 0.78:
            return dict(random.choice(HYPE_BURST_POOL))
        if roll < 0.90:
            return dict(random.choice(AI_ASTROTURF_POOL))
        return dict(random.choice(SABOTAGE_POOL))


stream_engine = RealTimeStreamEngine()


def format_sse_event(event_type: str, data: Any) -> str:
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"
