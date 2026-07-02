# CLAUDE.md — FitFusion AI (monorepo)

This file documents the **whole project**: the Next.js web app **and** the Python ML microservice that powers the 5-model intelligence layer. The frontend-specific rules live in `web/src/CLAUDE.md` — read that too when working under `web/`.

---

## Repo layout

```
fitfusion-ai-wb/
├── web/                  # Next.js 16 app (React 19, TypeScript)
│   └── src/
│       ├── app/          # App Router pages + /api routes
│       ├── components/
│       └── lib/
│           └── ml-service/   # typed client wrappers for the FastAPI service
├── ml-service/           # Python FastAPI microservice (the "ML brain")
│   ├── app/
│   │   ├── main.py
│   │   ├── auth.py
│   │   ├── config.py
│   │   ├── schemas.py
│   │   └── routers/      # one router per model
│   ├── models/           # saved artifacts (xgb json, .pt, .pkl) — gitignored
│   ├── training/         # offline training scripts (Colab/local GPU)
│   ├── tests/
│   ├── requirements.txt
│   ├── Dockerfile
│   └── render.yaml
├── docs/
└── CLAUDE.md             # this file
```

## Stack

**Web (`web/`)** — Next.js 16 App Router · React 19 · TypeScript · Tailwind · Supabase Postgres · Groq (llama-3.3) · ExerciseDB · deployed on Vercel.

**ML service (`ml-service/`)** — Python 3.11 · FastAPI · Uvicorn · XGBoost · scikit-learn · PyTorch · stable-baselines3 (PPO) · gymnasium · SHAP. Deployed on Render. Loads pre-trained artifacts from `ml-service/models/` at startup; never trains in production.

## The 5-model layer (overview)

| # | Model | Endpoint | Replaces |
|---|---|---|---|
| 1 | XGBoost + SHAP calorie predictor | `POST /predict/calorie` | hardcoded MET table |
| 2 | Hybrid recommender (cosine + CF) | `POST /recommend` | static workout/diet seed lists |
| 3 | Injury risk multi-label XGB (knee/back/shoulder) | `POST /predict/injury` | none (new signal) |
| 4 | PyTorch transformer trajectory (improve/plateau/regress) | `POST /predict/trajectory` | none (new signal) |
| 5 | PPO RL agent over `FitFusionEnv` | `POST /rl/action` | the if/else block in `/api/adaptive-replan` |

Orchestration target = `web/src/app/api/adaptive-replan/route.ts`:
> last 4 sessions → trajectory + injury scores → RL state `[completion_rate, sleep_avg, injury_flag, trajectory_score]` → RL action constrains the LLM prompt → calorie model labels exercises → recommender seeds next-week plan.

## Non-negotiable conventions

1. **Fallback or it didn't ship.** Every Next.js call into the ML service MUST pass a fallback. If the service is down, slow (>2 s), unauthorized, or returns malformed JSON, the existing rule-based logic runs and the user sees no error. The app must never hard-depend on the Python service.
2. **Train offline, serve online.** Training scripts live in `ml-service/training/` and are run on Colab GPU or locally by the user. The Render service only loads artifacts; it never trains. Artifacts in `ml-service/models/` are gitignored — they're produced by training and uploaded out-of-band.
3. **No data assumptions.** Before writing a training or preprocessing script, stop and confirm: which Kaggle dataset (URL + version), which columns, which Supabase tables/fields. Never invent a schema.
4. **Secrets stay out of the chat and the repo.** All keys read from env vars. `.env.example` files document names only. The user sets values themselves in `.env.local` and the Render dashboard.
5. **Auth between Next and FastAPI** = shared bearer token. Next.js sends `Authorization: Bearer ${process.env.ML_SERVICE_API_KEY}`. FastAPI verifies via `app/auth.py`. User identity is established in Next.js (Supabase JWT); the ML service does not re-verify users.
6. **One endpoint per model.** Don't bundle. Keeps fallback granular — if injury inference breaks, calorie still works.
7. **Pause between build steps.** Each step (skeleton, calorie, recommender, injury, transformer, RL, orchestration) lands on its own. Don't push ahead to the next step until the user has reviewed the previous one.
8. **Manual steps are flagged loudly.** Anything that needs the user to create an account, download a dataset, train on a GPU, set an env var, or click deploy gets a `>>> MANUAL STEP FOR YOU <<<` block. Don't try to do these things yourself.

## Environment variables

**Web (`web/.env.local` + Vercel):**
- `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (existing)
- `GROQ_API_KEY` (existing)
- `ML_SERVICE_URL` — e.g. `http://localhost:8000` locally, `https://fitfusion-ml.onrender.com` in prod
- `ML_SERVICE_API_KEY` — shared bearer; must match the Render value

**ML service (`ml-service/.env` + Render dashboard):**
- `ML_SERVICE_API_KEY` — same shared bearer
- `MODEL_DIR` — defaults to `./models`
- `LOG_LEVEL` — defaults to `info`

## Build order (canonical)

0. **CLAUDE.md** (this file). ✅
1. **FastAPI skeleton** with all 5 endpoints stubbed + Next.js client + fallbacks + `render.yaml`. Prove the round trip works.
2. **XGBoost + SHAP calorie predictor.**
3. **Hybrid recommender.**
4. **Injury risk classifier.**
5. **Transformer sequence model.**
6. **PPO RL agent + `FitFusionEnv`.**
7. **Full `/api/adaptive-replan` orchestration + tests.**

Each step ends with a one-line "test this before we move on" note.

## Supabase tables in play (from current code)

Confirmed used by `/api/adaptive-replan`: `workout_plans`, `workout_logs`, `profiles` (cols: `goal`, `weight`, `activity_level`, `injuries`), `sleep_logs` (col: `duration_hours`, `date`). Additional tables (e.g. `food_logs`, `body_metrics`, `injuries`) — will be confirmed with the user when the relevant step needs them.

## When in doubt

- Smallest safe change wins.
- If a model isn't ready yet, the stub + fallback path must still work end-to-end.
- Never silently degrade. Log when the fallback fires so the user knows the service is misbehaving.
