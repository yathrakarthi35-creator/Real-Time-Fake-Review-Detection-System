# TrustGuard AI — Real-Time Fake Review Detection System

A full-stack **Real-Time Fake Review Detection & Fraud Ops Platform** engineered for both local real-time SSE streaming and **Vercel Free Tier** serverless deployment (`< 50 MB` Python footprint, `< 15 ms` inference latency).

## Architecture Overview

- **Frontend (Next.js 14 App Router, TypeScript, Tailwind CSS, Recharts, Lucide):**
  - **Command Overview:** Live KPI telemetry, rolling ingestion timeline (`AreaChart`), verdict split (`PieChart`), star-rating distribution (`BarChart`), and a **Product Trust & Rating Distortion Leaderboard** comparing raw vs. Trust-Adjusted star ratings.
  - **Live Forensic Inspector:** Inspect review text, reviewer account age, review count, star rating, and verified purchase status with live-debounce analysis, inline trigger-word highlights, red/green flags, and automated triage (`APPROVED`, `FLAGGED_FOR_REVIEW`, `AUTO_QUARANTINED`).
  - **Real-Time SSE Stream & Webhook Ingest (`GET /api/stream/events`, `POST /api/ingest`):** Server-Sent Events push incoming reviews, coordinated burst alerts, and moderation overrides live to connected clients, with an interactive traffic simulator (`Normal`, `5-Star Bot Burst`, `Subtle AI Astroturfing`, `1-Star Competitor Sabotage`, `Duplicate Botnet`) and Webhook Playground.
  - **Batch CSV / JSON Scanner (`POST /api/batch-predict`):** Upload or paste up to 200 reviews for bulk auditing with within-batch near-duplicate detection and downloadable CSV audit reports.
  - **Moderation & Quarantine Queue:** Searchable queue with a native `<dialog>` forensic inspection modal and analyst verdict overrides (`POST /api/moderation/{id}`).
- **Backend / ML Engine (FastAPI + Scikit-learn / Zero-Dep NumPy):**
  - `api/features.py`: Shared 16-feature behavioral & linguistic extractor (sentiment polarity/subjectivity, punctuation & caps ratios, rating extremity, rating-tone mismatch, hype phrase density, AI/template astroturfing score, concrete specificity, first-person grounding, lexical diversity, and account risk) plus 3-gram Jaccard near-duplicate shingles.
  - `api/stream_engine.py`: Thread-safe sliding-window duplicate/burst detector and SSE pub/sub event bus.
  - `train_model.py`: Trains on 6,000 multi-archetype reviews and exports both `api/model.joblib` (Scikit-learn Pipeline) and `api/model.json.gz` (~21 KB zero-sklearn artifact for Vercel).

## Project Structure

```text
├── api/
│   ├── __init__.py
│   ├── features.py          # Shared 16-feature NLP + behavioral & explainability engine
│   ├── stream_engine.py     # Sliding-window duplicate/burst detector + SSE event bus
│   ├── index.py             # FastAPI backend (/api/health, /api/predict, /api/ingest, /api/stream/events, ...)
│   ├── model.json.gz        # Pre-trained lightweight TF-IDF + Behavioral Logistic Regression
│   └── model.joblib         # Scikit-learn Pipeline artifact
├── app/
│   ├── globals.css          # Tailwind base styles, focus rings, content-visibility containment
│   ├── layout.tsx           # Root Next.js App Router layout
│   └── page.tsx             # Command Center workspace with live SSE subscription
├── components/
│   ├── AnalyticsDashboard.tsx
│   ├── BatchScanner.tsx
│   ├── Header.tsx
│   ├── LiveStreamMonitor.tsx
│   ├── ModerationQueue.tsx
│   ├── ReviewAnalyzer.tsx
│   └── ReviewDetailDialog.tsx
├── lib/
│   └── types.ts
├── tests/
│   └── test_api.py
├── train_model.py
├── requirements.txt
├── next.config.mjs
└── vercel.json
```

## Running Locally (Windows PowerShell)

### 1. Install Dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
npm install
```

*(Optional)* Retrain the ML artifacts:
```powershell
python train_model.py
```

### 2. Start Backend & Frontend

**Single Command (Recommended — starts FastAPI on 8000 + Next.js on 3000):**
```powershell
npm run dev:full
```

Or run in two separate PowerShell windows:

**Terminal 1 — FastAPI Real-Time SSE Backend (Port 8000):**
```powershell
.\.venv\Scripts\uvicorn.exe api.index:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — Next.js Frontend (Port 3000):**
```powershell
npm run dev
```

Open **http://localhost:3000** in your browser.

### 3. Send a Real-Time Webhook Event from PowerShell

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/ingest" -Method Post -ContentType "application/json" -Body '{"product_name":"AeroPods Pro ANC Earbuds","reviewer":"LiveWebhook","rating":5,"verified_purchase":false,"text":"BEST EARBUDS EVER!!! 100% RECOMMEND!!"}'
```
