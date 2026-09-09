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

| # | Model | Endpoint | Replaces | Consumed by |
|---|---|---|---|---|
| 1 | XGBoost + SHAP calorie predictor | `POST /predict/calories` | hardcoded MET table | `/api/workout-log` |
| 2 | Hybrid recommender (cosine + CF) | `POST /recommend` | static workout/diet seed lists | `/api/generate-plan` |
| 3 | Injury risk multi-label XGB (knee/back/shoulder/hamstring) | `POST /predict/injury-risk` | reactive injury logging | `/api/adaptive-replan` |
| 4 | PyTorch transformer trajectory (improve/plateau/regress) | `POST /predict/trajectory` | single-week completion rate | `/api/adaptive-replan` |
| 5 | PPO RL agent over `FitFusionEnv` | `POST /rl/action` | the if/else block in `/api/adaptive-replan` | `/api/adaptive-replan` |

`/predict/calorie` and `/predict/injury` remain as aliases for the Step 1 paths.

Orchestration target = `web/src/app/api/adaptive-replan/route.ts`:
> one shared read of the user's week (`lib/ml-service/history.ts`) → injury risk → trajectory over the last 4 sessions → RL state `[completion_rate, sleep_avg/10, injury_flag, trajectory_score/2, streak/14]` → RL action sets the LLM directive → deterministic post-processing applies the ±15% intensity delta, strips exercises loading flagged muscle groups, and inserts a rest day → decision record written to `workout_plans.ml_meta`.

`/api/ml-insights` (GET) serves the same history to the analytics dashboard so the readout and the replan can never disagree.

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
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — **optional**. Only needed if you want
  `POST /predict/injury-risk` to read Supabase itself when given nothing but a
  `user_id`. Next.js normally sends the features, so leave these unset and the ML
  service holds no database credentials.

## Build order (canonical)

0. **CLAUDE.md** (this file). ✅
1. **FastAPI skeleton** with all 5 endpoints stubbed + Next.js client + fallbacks + `render.yaml`. ✅
2. **XGBoost + SHAP calorie predictor.** ✅
3. **Hybrid recommender.** ✅
4. **Injury risk classifier.** ✅
5. **Transformer sequence model.** ✅
6. **PPO RL agent + `FitFusionEnv`.** ✅
7. **Full `/api/adaptive-replan` orchestration + tests.** ✅

Training pipelines live in `ml-service/training/` — see its README. Real metrics
per model are written to `ml-service/models/reports/*.json`; two documented
targets are not met (calorie MAE and transformer accuracy) and the reports say so
rather than rounding up.

## Supabase tables in play (verified against the live database)

Read by the ML layer:

- `profiles` — `id` (there is **no** `user_id` column on the live table), `age`,
  `gender`, `height`, `weight`, `goal`, `activity_level`, `injuries` (free text),
  `dietary_restrictions` (jsonb), `diet_preference`, `rest_days_per_week`, `days_off`
- `workout_logs` — `date`, `is_assigned`, `plan_id`, `total_calories`
- `exercise_logs` — `workout_log_id`, `exercise_name`, `sets`, `reps`, `weight`, `duration`, `calories`
- `workout_execution` — `date`, `exercise_name`, `done` (the true completion signal)
- `sleep_logs` — `sleep_hours`. **Not `duration_hours`**: the migration file declares
  both but the live table only has `sleep_hours`, and every other screen writes it.
  `/api/adaptive-replan` previously selected `duration_hours`, which errored and
  left average sleep permanently null.
- `injuries` — `body_part`, `name`, `severity`, `status`
- `vitals_logs` — `resting_heart_rate`. Currently **empty**, so the calorie and
  injury models impute resting BPM from the training-set median and report it in
  the `imputed` field of every response.

Written by the ML layer:

- `workout_plans.injury_risk` (jsonb) and `workout_plans.ml_meta` (jsonb), added by
  `web/supabase/migrations/20260909_ml_audit_columns.sql`. The replan route inserts
  with these columns and retries without them if the migration has not been run,
  so the same payload always survives inside `plan.ml_meta`.

## When in doubt

- Smallest safe change wins.
- If a model isn't ready yet, the stub + fallback path must still work end-to-end.
- Never silently degrade. Log when the fallback fires so the user knows the service is misbehaving.
