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

**Web (`web/`)** — Next.js 16 App Router · React 19 · TypeScript · Tailwind · Supabase Postgres · Groq (main LLM; model set in `lib/groq-model.ts`) · OpenAI (food-photo vision, inspiration analysis, assistant embeddings) · ExerciseDB · deployed on Vercel.

**ML service (`ml-service/`)** — Python 3.11 · FastAPI · Uvicorn · XGBoost · scikit-learn · PyTorch · stable-baselines3 (PPO) · gymnasium · SHAP. Deployed on Render. Loads pre-trained artifacts from `ml-service/models/` at startup; never trains in production.

## The 5-model layer (overview)

| # | Model | Endpoint | Replaces | Consumed by |
|---|---|---|---|---|
| 1 | Session energy expenditure: calibrated XGBoost HR model + SHAP (Keytel, then MET fallback) | `POST /predict/calories` | MET-only estimate | `/api/workout-log` (Cardio + Workout tabs) |
| 2 | Hybrid meal recommender (0.5 popularity + 0.25 ALS + 0.25 ingredient TF-IDF) within dietary filters + calorie bands; content-based exercise recommender | `POST /recommend`, `POST /recommend/exercises` | LLM-invented meals, calories and exercises | `/api/generate-plan` |
| 3 | Training-load injury risk (XGBoost on 74 runners' real injuries; not served, failed its pre-registered rule) + rule-based body regions (knee/back/shoulder/hamstring) | `POST /predict/injury-risk` | reactive injury logging | `/api/adaptive-replan`, `/api/ml-insights` |
| 4 | PyTorch transformer trajectory (improve/plateau/regress) | `POST /predict/trajectory` | single-week completion rate | `/api/adaptive-replan` |
| 5 | PPO RL agent over `FitFusionEnv` | `POST /rl/action` | the if/else block in `/api/adaptive-replan` | `/api/adaptive-replan` |

`/predict/calorie` and `/predict/injury` remain as aliases for the Step 1 paths.

Stage 1 was rebuilt on 2026-09-16 with lab calorimetry data. The earlier XGBoost
model was trained on `valakhorasani/gym-members-exercise-dataset`, whose calorie
labels are not physiological (yoga burns the same ~720 kcal/h as HIIT), and has
been retired. A heart-rate XGBoost model trained on the Malaga treadmill
dataset beat the published Keytel equation out of the box, but tied it once both
were calibrated on WEEE (held-out-participant MAE 1.27 vs 1.29 kcal/min,
p = 0.16). On 2026-10-27 the user chose to serve the calibrated XGBoost model
(the project specifies an explainable XGBoost predictor), with per-request SHAP
contributions; the tie with Keytel is documented, not hidden. It needs heart rate,
age, sex and height; without height or the model artifact, calibrated Keytel runs
(`estimator: "keytel"` + `fallback_reason`); non-cardio sessions, missing HR or HR
outside the validated range get the MET estimate and a `reason`. The Gym Members
design from the slides is trained only as a documented comparison
(`training/train_calorie_gym_comparison.py`). Teacher demo: `ml-service/demos/model1_calorie/`.

Stage 2 was rebuilt on 2026-09-16/17 on the Food.com dataset (231,637 recipes,
1.13M ratings). The old workout-type collaborative filter scored below "always
say Strength" and its prompt claimed the styles "have been effective", which the
data never supported — both are gone. A trained ALS recommender was then
evaluated properly: a first test favoured ALS only because the popularity
baseline was frozen for five years, and a corrected rolling yearly evaluation
(2012-2017, 20,031 user-years, both methods refreshed each year) put popularity
ahead — Recall@10 0.0197 vs 0.0164, difference CI [-0.0051, -0.0013]. So Stage 2
ships **without** ML: most-liked recipes of the last 365 days, filtered by
ingredient-checked dietary flags and a per-meal calorie band. The daily target
comes from Mifflin-St Jeor x activity factor (`web/src/lib/meal-targets.ts`), and
`/api/generate-plan` enforces that every meal in `diet_plan` is one of the
returned recipes, so meal calories are real instead of invented.

Stage 2 was extended on 2026-10-28 into a hybrid (the user's spec). A blend of
popularity, ALS and ingredient TF-IDF, tuned on 2012-13 and tested once on
2014-2017 (9,146 user-years), beat popularity on Recall@10 (0.0235 vs 0.0198,
CI [+0.0016, +0.0057]) and is served (`training/train_meal_hybrid.py`,
`app/meal_hybrid.py`). Personal history = plan recipes marked eaten
(`web/src/lib/ml-service/meal-history.ts`), folded into ALS per request;
no history = popularity (cold start). Exercises come from a content-based
cosine recommender over free-exercise-db (876 exercises, public domain) after
hard filters for equipment, injuries, level and target muscles
(`app/exercise_recommender.py`). **Vegetarian = no meat and no egg** (the app
offers Eggetarian separately). Teacher demo: `ml-service/demos/model2_recommender/`.

Stage 3 was rebuilt on 2026-10-28. The old multi-label model labelled Gym Members
rows with rules over its own inputs (F1 = 1.0 was circular) and is retired. No open
dataset has real knee/back/shoulder/hamstring labels (SoccerMon: knee 10 episodes
from 5 players, no shoulder), so the design is: an overall training-load risk model
on the Lövdal et al. runners data (CC0, 583 injuries; last 7 days of sessions, run
km, strength sessions, other cardio hours) plus a fixed rule table for regions
(`app/injury_load.py`, mirrored in `web/src/lib/ml-service/injury-rules.ts`). The
protocol was committed before training (`demos/model3_injury/PROTOCOL.md`). XGB-APP
scored test ROC-AUC 0.589 [0.482, 0.667], so by that rule it is **not served**;
logistic regression scored 0.669 on test but lower on development, and on
2026-10-28 the user chose not to serve it either (rules only). The exercise matcher is word-boundary based on both sides
(`keyword_pattern` / `keywordPattern`): "Pullups" loads shoulder, "Crunch" no
longer loads knee. Teacher demo: `ml-service/demos/model3_injury/`.

Dietary flags are a safety feature, not a nicety. They are built from ingredient
lists (the dataset's own "vegetarian" tag is wrong on 631 recipes), guarded a
second time by the recipe name (Food.com sometimes omits the main protein, e.g.
"tuna noodle casserole" lists no tuna), and audited by hand twice: 47/50 before
the plural fix, 50/50 after. Live testing then caught further misses (rump roast,
gorgonzola as vegan, ditalini as gluten-free); each fix has a regression test in
`ml-service/tests/test_meal_data.py`. A restriction the flags cannot verify
(halal, kosher, pescatarian, low sodium) returns **no** recipes rather than risky
ones.

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
- `OPENAI_API_KEY` — needed by `/api/analyze-food`, `/api/analyze-inspiration`,
  `/api/assistant` and `/api/seed-knowledge`. Full list of names in `web/.env.example`.
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
2. **Session energy expenditure** — rebuilt 2026-09-16 on lab calorimetry (see above). ✅
3. **Meal recommender** — rebuilt 2026-09-16/17 on Food.com (see below). ✅
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
- `vitals_logs` — `heart_rate` (verified live 2026-10-26; the migration file now
  matches, along with `blood_sugar`, `spo2`, `body_temp`). Currently **empty**. No model
  reads it any more (Stage 1 and Stage 3 both stopped using resting BPM).
- `cardio_logs` — `activity`, `duration_minutes`, `distance_km`, `avg_heart_rate`, `calories_burned`.
  The Cardio tab sends `avg_heart_rate` to Stage 1; Stage 3 reads distance and duration.

Written by the ML layer:

- `workout_plans.injury_risk` (jsonb) and `workout_plans.ml_meta` (jsonb), added by
  `web/supabase/migrations/20260909_ml_audit_columns.sql`. The replan route inserts
  with these columns and retries without them if the migration has not been run,
  so the same payload always survives inside `plan.ml_meta`.

## When in doubt

- Smallest safe change wins.
- If a model isn't ready yet, the stub + fallback path must still work end-to-end.
- Never silently degrade. Log when the fallback fires so the user knows the service is misbehaving.
