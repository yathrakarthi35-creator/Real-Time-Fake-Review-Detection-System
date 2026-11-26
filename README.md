# Real-Time Fake Review Detection System

A production-ready full-stack AI web application engineered for **Vercel Free Tier** (staying well under the 250 MB serverless bundle limit and executing inference in `< 100 ms`), with a **pre-trained ML model (`api/model.json.gz`) already included** so you can push to GitHub and deploy immediately.

## Architecture Overview

- **Frontend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS (Dark/Light mode), Lucide Icons, and Recharts.
- **Backend / ML Engine:** Python FastAPI running as Vercel Serverless Functions (`/api/index.py`), powered by a pre-trained **TF-IDF (1,200 unigrams/bigrams) + 12 Behavioral Features Logistic Regression** model (`api/model.json.gz`, ~11 KB), plus optional `train_model.py` (Scikit-learn `api/model.joblib`) if you want to retrain on custom datasets.
- **Storage:** Browser `localStorage` + in-memory session state for instant zero-config analytics on Vercel, with optional `.env.example` hooks for Vercel Postgres / Supabase.

## Project Structure

```text
fake-review-detector/
├── api/
│   ├── __init__.py          # Python package marker
│   ├── features.py          # Shared NLP + 12 behavioral features & explainability engine
│   ├── index.py             # FastAPI serverless app (/api/health, /api/predict, /api/sample-stream)
│   └── model.json.gz        # Pre-trained TF-IDF + Behavioral Logistic Regression model (ready for Vercel)
├── app/
│   ├── globals.css          # Tailwind base styles + dark/light theme support
│   ├── layout.tsx           # Root Next.js App Router layout
│   └── page.tsx             # Main dashboard orchestrating Analyzer, Stream, and Charts
├── components/
│   ├── AnalyticsDashboard.tsx   # KPI cards + Recharts Pie & Star-Rating Bar charts
│   ├── Header.tsx               # Branding, API health badge, reset button, theme toggle
│   ├── LiveStreamSimulator.tsx  # 2-second live review stream + automatic fake burst alerts
│   └── ReviewAnalyzer.tsx       # Debounced analyzer, trigger highlights, red/green flags
├── lib/
│   └── types.ts             # Shared TypeScript interfaces & localStorage helpers
├── .env.example             # Optional DB/Supabase hooks
├── .gitignore               # Preserves api/model.json.gz & api/model.joblib for Vercel deployment
├── next.config.mjs          # Proxies /api/* to localhost:8000 during local dev
├── package.json             # Next.js 14, Tailwind, Lucide, Recharts
├── postcss.config.mjs       # PostCSS config
├── requirements.txt         # Lightweight Python deps (< 50 MB on Vercel)
├── tailwind.config.ts       # Tailwind darkMode: "class" config
├── train_model.py           # Optional Scikit-learn trainer to retrain & export api/model.joblib
├── tsconfig.json            # TypeScript configuration
└── vercel.json              # Routes /api/* -> /api/index.py and everything else -> Next.js
```

---

## Step-by-Step Windows PowerShell Guide

### 1. Prerequisites
Ensure you have **Python 3.10+**, **Node.js 18+**, and **Git** installed on Windows:

```powershell
python --version
node --version
git --version
```

### 2. Extract & Enter the Project Directory

```powershell
cd path\to\real-time-fake-review-detector
```

### 3. Install Python & Node Dependencies

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt
npm install
```

*(Optional)* If you want to retrain with Scikit-learn and overwrite with `api\model.joblib`:
```powershell
python train_model.py
```

### 4. Run Locally (Two PowerShell Windows)

**Terminal 1 — Python FastAPI Backend (Port 8000):**
```powershell
cd path\to\real-time-fake-review-detector
.\.venv\Scripts\Activate.ps1
uvicorn api.index:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 — Next.js Frontend (Port 3000):**
```powershell
cd path\to\real-time-fake-review-detector
npm run dev
```

Open **http://localhost:3000** in your browser. Quick API sanity check in PowerShell:
```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:8000/api/health" -Method Get
```

### 5. Push to GitHub

Create a new empty repository on GitHub (e.g., `real-time-fake-review-detector`), then run:

```powershell
git init
git add .
git commit -m "Initial commit: Real-Time Fake Review Detection System with pre-trained ML model"
git branch -M main
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/real-time-fake-review-detector.git
git push -u origin main
```

### 6. Deploy Live on Vercel (Free Tier)

1. Go to **https://vercel.com/new** and sign in with GitHub.
2. Click **Import** next to `real-time-fake-review-detector`.
3. Keep the default **Framework Preset: Next.js** and Root Directory `./`.
4. Click **Deploy** (no environment variables required).
5. Once live, verify `https://<your-vercel-url>/api/health` returns `"model_loaded": true`.
