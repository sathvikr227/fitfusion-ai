# FitFusion AI — handoff prompt for the next session (written 2026-10-28)

> **How to use this:** start a new Claude Code session in
> `C:\Users\Sathv\OneDrive\Desktop\fitfusion-ai-wb` and say:
> *"Read `docs/NEXT_SESSION_PROMPT.md` and `CLAUDE.md`, then continue from 'Where to start'."*

---

## 0. Your role and the rules that still apply

Act as a senior ML engineer, Python backend engineer, data engineer and full-stack developer on
my existing FitFusion AI project. FitFusion is a Next.js 16 + Supabase fitness app with a Python
FastAPI ML service. The goal is **five individually working, reproducible, evaluated, data-backed
ML models** that I can run, explain and demonstrate to my college evaluator. Code that only looks
finished doesn't count.

The rules, from my original brief and from how we've worked so far:

1. **One model at a time.** Models 1 and 2 are done. Next is **Model 3**, then 4, then 5, then
   Phase 6 (integration). Don't start a model until I approve the previous one. Finish each with a
   **completion report** (format in §6) and ask for my approval.
2. **Real data only.** Use genuine, identifiable datasets and document each one: title,
   publisher, URL, licence, access date, files, record counts, columns, cleaning, public / private /
   simulated, limitations.
   - Never fabricate data, labels, metrics, histories or results.
   - Synthetic data is allowed only for RL simulation and tests, and must always be labelled as
     simulated.
   - If a dataset needs a login, licence acceptance or download I must do, **stop and ask me** with
     exact steps.
3. **Honest results.** Pre-register the evaluation protocol and the keep/serve rule *before*
   seeing test results. Always compare against baselines. If a target from my slides isn't met,
   report the measured number and explain why. Never tune on the test set.
4. **Presentable output for every model** (I stressed this). Each model gets a teacher folder
   `ml-service/demos/modelN_<name>/` containing:
   - `README.md`, `DATA_SOURCES.md`, `RESULTS.md`;
   - `demo.py`, which prints *real* computed results in numbered sections and saves them to
     `outputs/demo_output.txt` plus a JSON file;
   - a labelled sample input;
   - figures;
   - `outputs/test_results.txt`.

   Copy the structure of `demos/model1_calorie/` and `demos/model2_recommender/`.
5. **Safety.** Injury outputs are informational risk indicators, never diagnoses. No LLM or RL
   policy may override safety constraints (injury stripping, pain holds, volume caps, dietary
   filters).
6. **Project conventions** (`CLAUDE.md`):
   - every Next→ML call has a fallback, with a 2 s timeout;
   - train offline, serve online;
   - artifacts in `ml-service/models/` are gitignored, but `models/reports/` is committed;
   - one endpoint per model;
   - shared bearer auth;
   - secrets only in env vars;
   - flag manual steps loudly.
7. **Git.** Work on branch `feat/ml-intelligence-layer`.
   - Focused commits ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
   - Push with `git push -u origin feat/ml-intelligence-layer`.
   - Never commit secrets, `.pkl` artifacts, `data/`, or `*.zip` (now gitignored).
   - Don't open a PR unless I ask.
8. **Ask me only when genuinely needed.** That covers dataset downloads behind logins, licence
   acceptance, Supabase migrations that change production, deploy settings and env vars,
   ambiguous requirements, and anything destructive.
9. **Tools you can use.**
   - **Supabase MCP**: works. Project id `ckxjfxufbrdawzshsupn`, named "fitfusion". Use it for
     read-only inspection and aggregate queries. **Ask me before any write or migration.** Don't
     expose individual users' records in demos.
   - **Chrome (Claude in Chrome)**: I have it connected. Load the `anthropic-skills:chrome-browser`
     skill first. Use it to:
     - test signed-in app flows locally or on Vercel;
     - inspect dataset pages;
     - download datasets through my logged-in browser (e.g. Kaggle) after I approve.
   - **Vercel MCP**: project `prj_hxjoTpLutMdKEF8ewmA7XEhJ1IMQ`, team
     `team_WkQRwSPgUC276jlXp12j3QuP`. Read freely; ask before changing env vars or deploying.
   - **GitHub MCP**: sometimes fails to connect; plain `git` works.

---

## 1. Environment facts and gotchas (read before running anything)

- Windows 11, Git Bash tool. Use `ml-service/.venv/Scripts/python.exe`, which is Python 3.12.10
  with:
  - xgboost 3.4.1, shap 0.52.0, scikit-learn 1.9.0, pandas 3.0.5;
  - torch 2.14.0+cpu, stable-baselines3 2.9.0, fastapi 0.115.0.

  `render.yaml` pins Python 3.11.9 for deploy.
- **Heredoc backslash bug.** Inside Bash heredocs, `\\` collapses to `\`. That has turned `\b`
  into a backspace character and `\n` into real newlines inside string literals.
  - Make edits with the **Edit tool**, or write Python edit scripts with the **Write tool** and
    run them.
  - Use `chr(92)` when you need a backslash from a script.
  - After any scripted edit, grep for `$'\x08'` (backspace) and for broken string literals.
- **Memory.** About 4 GB of RAM is free. Never run two heavy Python jobs at once: running
  concurrently once made an evaluation about 100× slower. Run long jobs with
  `run_in_background` and `python -u` into a log file, and wait with an `until grep` loop.
- **Encoding.** Python scripts need `sys.stdout.reconfigure(encoding="utf-8")` or
  `PYTHONIOENCODING=utf-8`. `training/common.py` already handles this for trainers.
- **CRLF.** Many web files are CRLF. Node edit scripts should normalise to `\n`, edit, then
  restore.
- **Checks:**
  - Web: `cd web && npx tsc --noEmit` (check `${PIPESTATUS[0]}`, not `tail`'s exit code) and
    `npx eslint <paths>`. Warnings already exist; don't add new ones.
  - ML: `cd ml-service && .venv/Scripts/python -m pytest -q`. **193 tests pass right now.**

---

## 2. What is DONE (all pushed; latest commit `4cd07fb`)

### 2.1 Codebase cleanup and security (session 1)
- **Auth.** Four LLM routes were public: `analyze-food`, `analyze-food-text`, `help/recipe` and
  `help/workout`.
  - They now require a Supabase session via `web/src/lib/supabase/require-user.ts`.
  - `proxy.ts` rate-limits them as AI routes (20 per minute) and rate-limits the remaining public
    routes too.
  - The client sends the token via `authHeaders()` in `lib/supabase/client.ts`.
  - The ML service compares bearer tokens with `hmac.compare_digest`.
- `web/.env.example` documents every environment variable, including `OPENAI_API_KEY`, which 4
  routes use.
- Removed the unused Expo app `myApp/`. `*.zip` is gitignored. Removed two clean leftover
  worktrees.
- `vitals_logs` migration definition now matches the live table: `heart_rate`, `blood_sugar`,
  `spo2`, `body_temp`.

### 2.2 QA report fixes (commit `44dffd8`)
- **Groq JSON failures** (grocery list, recipe help). The gpt-oss reasoning model was using up
  `max_tokens`. Fix: `web/src/lib/groq-json.ts`, with `reasoning_effort: "low"` for gpt-oss models,
  larger budgets and one retry. Provider error text is no longer shown to users.
- **Weekly check-in overload.** The volume increase was applied twice.
  - The LLM now keeps sets and reps unchanged.
  - Code applies the delta, capped at +1 set and +2 reps per exercise and +10% total weekly sets
    (`limitProgression` in `lib/ml-service/injury-rules.ts`).
  - Pain mentioned in check-in notes holds volume (no INCREASE) and strips exercises that load the
    painful area (`painGroupsFromText`).
- **Completion rate** is now calculated over the exercises the plan scheduled, not only ticked
  rows (`plannedExerciseCount` in `lib/ml-service/history.ts`). The check-in screen reads the same
  server number from `/api/ml-insights`.
- **Plan generation.**
  - Profile injuries become a hard constraint in the prompt and are enforced in code.
  - The same muscle group is never scheduled on consecutive days (`lib/plan-structure.ts`).
- **Onboarding injuries** are copied into the Injury Tracker.
- **AI report** judges surplus or deficit against TDEE and flags likely under-logging.
- **Range validation** (`lib/validation.ts`) on onboarding, profile, weight, sleep and vitals.
  Vitals now use ACC/AHA blood-pressure categories and have a delete button.
- **Migration** `web/supabase/migrations/20261026_input_range_checks.sql` (NOT VALID check
  constraints) is written but **NOT applied**. It needs my approval.

### 2.3 Model 1: XGBoost + SHAP calorie predictor ✅ (commits `a9928b7`, `bc24863`)
- **Served:** an XGBoost heart-rate model trained on Malaga treadmill lab calorimetry (PhysioNet,
  CC BY-NC-SA 4.0, confirmed by me): 10,186 windows from 840 people.
  - Calibrated on WEEE (Zenodo, CC BY 4.0, 16 people): kcal/min = 0.3075 + 0.6185 × model.
  - Per-request TreeSHAP from `app/calorie_model.py`.
  - Falls back to calibrated Keytel (no height or no artifact), then the MET table.
- **Metrics:**
  - Malaga cross-validation by person: MAE 1.50 kcal/min, R² 0.77.
  - WEEE external test: MAE 2.88 vs Keytel 3.91.
  - Calibrated, leave-one-person-out: MAE 1.27 vs Keytel 1.29, **p = 0.16, a tie**. This is
    documented.
- **Gym Members comparison** (the slide design), `training/train_calorie_gym_comparison.py`:
  - Held-out MAE 86.0 kcal; the 25 kcal target is not met.
  - The labels fit a Keytel-form formula with R² 0.991, i.e. they aren't real measurements.
- **App:** `/api/workout-log` sends height; the Cardio tab shows the estimator and SHAP factors.
- Teacher folder `ml-service/demos/model1_calorie/`; 20 tests.

### 2.4 Model 2: hybrid recommender ✅ (commits `b75010b`, `4cd07fb`)
- **Meals (served).** Score = 0.5 popularity + 0.25 ALS (collaborative filtering) + 0.25
  ingredient/tag TF-IDF cosine (content), on Food.com: 1,003,724 likes, 180,310 users.
  - Weights tuned on 2012–13; pre-registered rolling test 2014–2017 (9,146 user-years):
    Recall@10 **0.0235 vs popularity 0.0198**, CI [+0.0016, +0.0057], ahead in every year → served.
  - Precision@5 is 0.0039; the 70% target is not met and the docs explain why.
  - Code: `app/meal_hybrid.py`, `app/routers/recommend.py` (accepts `liked_recipe_ids`),
    `training/train_meal_hybrid.py`, `training/build_meal_hybrid_serving.py`.
  - Artifacts: `meal_hybrid_serving.pkl` (83 MB) and `meal_hybrid_demo.pkl` (cutoff 2018).
  - History comes from `web/src/lib/ml-service/meal-history.ts` (eaten plan meals → `recipe_id`).
    No history = popularity (cold start).
- **Exercises (served).** Content-based cosine over free-exercise-db: 876 exercises, Unlicense,
  pinned commit `f00c92c`.
  - Hard filters for equipment, injuries, level and target muscles run first.
  - Code: `app/exercise_recommender.py`, `POST /recommend/exercises`,
    `training/build_exercise_index.py`.
  - Evaluation: constraint satisfaction 1.0; goal alignment@5 0.889 vs 0.774 for random within the
    same filters.
  - `generate-plan` seeds "EXERCISE OPTIONS" for push, pull, legs and core.
- **Safety fix: Vegetarian now excludes egg**, because FitFusion offers Eggetarian separately.
  There's a recipe-name egg guard too; the catalog was rebuilt and regression tests added.
- **Live data:** only 1 of 211 plans has recipe IDs, so real users are cold-start until
  recipe-backed plans reach production.
- Teacher folder `ml-service/demos/model2_recommender/`; 130 Model 2 tests.

---

## 3. What is LEFT, in order

### 3.1 Model 3: multi-label injury-risk classifier (NEXT; needs my approval to start, which I'm giving by sending this prompt)

**Spec from my slides**
- Labels: knee, back, shoulder, hamstring.
- XGBoost MultiOutputClassifier, F1 > 0.75 per label.
- Data: "Gym Members Exercise Dataset + a Sports Injury Dataset".

**What exists now (audit it again, don't trust it)**
- `training/train_injury.py`, artifact `models/injury_risk_model.pkl`, report
  `models/reports/injury_risk.json`.
- It's trained on Gym Members (973 rows) with **proxy labels made by if-rules over the model's
  own input features**. For example, knee = Resting_BPM > 68 AND frequency ≥ 4; the documented
  thresholds matched 0 rows, so they were moved.
- That's **circular**: F1 = 1.0 because the model just re-learns the rules. It is not injury
  prediction.
- Serving: `app/routers/injury.py` (`POST /predict/injury-risk`, alias `/predict/injury`) and
  `app/supabase_reader.py` (an optional self-read from Supabase).
- Features used at serving: age, BMI, resting BPM (imputed, because `vitals_logs` is empty),
  workout frequency, experience level, sleep, prior injuries.
- Web consumers:
  - `lib/ml-service/history.ts` builds `injuryFeatures`;
  - `/api/adaptive-replan` uses `injury.flagged` (threshold 0.7) to strip exercises and add a rest
    day (`lib/ml-service/injury-rules.ts` `applyInjuryAdjustments`);
  - `/api/ml-insights` and `InjuryRiskWidget.tsx` show the risk.

**Known bug to fix in this phase.** `app/features.py`
`exercise_targets_muscle_group` and web `injury-rules.ts` `exerciseTargetsGroup` use plain
substring matching. So "Pullups" doesn't match "pull up" and a shoulder-injured user can get
pull-ups. Reuse the word-boundary, gap-tolerant matcher `keyword_pattern` from
`app/exercise_recommender.py` (and port it to TS). Add tests.

**What to do**
1. **Find genuinely labelled injury data.**
   - Search for and verify real datasets with observed injuries. Candidates to check (verify
     existence, licence and content before relying on any):
     - Lövdal, den Hartigh & Azzopardi, *Injury Prediction in Competitive Runners* (2021,
       University of Groningen, DataverseNL): about 74 runners, 7 years of daily and weekly
       training logs with injury events. It's real, but labels are injured / not injured, not by
       body part.
     - Kaggle "injury prediction" datasets. **Many are synthetic: check the description and the
       label distributions.**
     - Anything with body-part-specific labels.
   - Report what you find and **ask me which to use** before downloading or building. Use Chrome
     for Kaggle downloads after I approve.
2. **If no dataset has knee / back / shoulder / hamstring labels, stop and present the options.**
   Don't invent labels. Possible options:
   - (a) a real "overall injury risk" model (e.g. on the runners data), with body-part mapping
     done by transparent rules (exercise → muscle group) and labelled as rules;
   - (b) keep the proxy-rule model but present it honestly as a rule system, not ML;
   - (c) another source you find.
3. **Leakage-safe design.** Use only features available *before* the prediction window, such as
   training load over prior weeks and acute:chronic workload ratio. Split by athlete and/or time.
4. **Class imbalance.** Report the prevalence for each label, use `scale_pos_weight` or similar,
   and pick probability thresholds on **validation** data only.
5. **Evaluation.** For each label: precision, recall, F1, confusion matrix and PR-AUC/ROC-AUC,
   plus an overall summary. Compare against baselines (prevalence-only and a simple
   logistic/workload rule). F1 > 0.75 may well be unreachable with real labels; report the
   truth.
6. **Integration.**
   - Keep the `/predict/injury-risk` contract: `risk` per label, `threshold`, `flagged`,
     `imputed`, `disclaimer`.
   - Update the features `history.ts` sends.
   - The output must always say it's not a diagnosis.
   - Keep the replan safety rules in place: rules and pain holds still apply whatever the model
     says.
7. **Teacher folder** `demos/model3_injury/`. The demo shows the data, label definition, class
   balance, all four outputs for a labelled sample input, metrics and figures (confusion matrices,
   PR curves).
8. Tests, docs (update CLAUDE.md and the training README), commit, completion report, then ask
   before Model 4.

### 3.2 Model 4: Transformer workout-sequence predictor (after Model 3 is approved)

**Spec**
- Input: the last 4 sessions. Output: IMPROVE / PLATEAU / REGRESS.
- PyTorch TransformerEncoder with 2 layers and 4 heads.
- Target accuracy > 65%, with macro-F1 also reported. "Pilot cohort of 12 users."

**What exists now**
- `training/train_transformer.py`; artifacts `models/transformer_model.pt` and
  `transformer_meta.json`; `app/trajectory_model.py`; `app/routers/trajectory.py`
  (`POST /predict/trajectory`); report `models/reports/transformer.json`.
- It's trained on **pseudo-sequences** built from Gym Members, with proxy completion and a
  **synthetic** day of week.
- Accuracy 0.459 vs majority class 0.389; MLP 0.427; GBM 0.40. The target isn't met.
- The pilot data was only 2 users and 14 user-days (`data/pilot/*.csv`, from
  `training/export_pilot_data.py`).
- Web: `history.ts` builds 4 sessions (duration, completion_rate, workout_type, day_of_week);
  `/api/adaptive-replan` and `/api/ml-insights` consume the result.

**Caution about Supabase data.** There are now 51 profiles, 682 workout_logs (43 users) and 2,536
workout_execution rows. But **some or all of it may be simulated**:
- commit `c0327ff` "seed six months of simulated training history";
- `training/seed_demo_history.py` (one user, writes undo SQL);
- `web/supabase/seed/seed_6_months.sql`, which seeds the first auth user.

Before using any of it, work out which users are real and which are seeded: check `created_at`
clustering, the seed's patterns and notes, and ask me. **Never present seeded data as real
pilot data.**

**What to do**
1. Find **real chronological workout logs** with a performance measure. Candidates to verify:
   - the runners dataset above (daily sessions with distance and pace, 74 athletes);
   - Endomondo / FitRec (Ni, Muhlstein & McAuley 2019, UCSD), with per-workout HR, speed and
     sport for many users. Check the licence (research use).
   - real FitFusion users, if enough non-seeded history exists.
2. **Define the target precisely**, without leakage. For example: compare a performance metric
   (pace at a given HR, or distance/volume) over the *next* k sessions with the last 4. IMPROVE if
   it's above +x%, REGRESS if below −x%, otherwise PLATEAU. Set x on training data only, and
   document it. Inputs must come strictly before the target window.
3. Build sequences of 4 real sessions. **Split by user** (and time); no overlapping windows across
   splits.
4. Model: PyTorch TransformerEncoder (2 layers, 4 heads, d_model 32–64), positional encoding,
   masking if needed. Fixed seeds. Save, load and evaluate reproducibly.
5. Baselines: majority class, last-delta rule, logistic regression and GBM on flattened features.
   Report accuracy, macro-F1 and the confusion matrix. Report honestly whether 65% is reached.
6. Inference: accepts exactly the last 4 valid sessions and returns class probabilities and a
   label. Test insufficient history, missing sessions, malformed input and model loading.
7. **Map to FitFusion features.** The app logs duration, completion, type and date. If the
   training data's features differ, document the mapping, or restrict to features both have. Say
   clearly if the deployed inputs differ from training.
8. Teacher folder `demos/model4_trajectory/`. The demo shows the 4 input sessions and the
   predicted class with probabilities, plus metrics and figures. Then tests, docs, commit, report,
   and ask before Model 5.

### 3.3 Model 5: PPO RL adaptive-replanning agent (after Model 4 is approved)

**Spec**
- State: [completion rate, average sleep, injury flag, trajectory score, streak].
- Actions: REDUCE / MAINTAIN / INCREASE.
- Stable-Baselines3 PPO, about 100k **timesteps** (not episodes; keep the two distinct).
- 500 test episodes vs the rule-based baseline, with the environment calibrated on pilot data.

**What exists now**
- `app/rl_env.py` (FitFusionEnv, Gymnasium), `training/train_rl_agent.py`,
  `models/fitfusion_rl_agent.zip`, `app/routers/rl_action.py` (`POST /rl/action`), report
  `models/reports/rl_agent.json`.
- PPO with 100k timesteps, seed 42, calibrated on 2 pilot users.
- **PPO mean reward 3.771 vs rule-based 3.878, so it loses.** It picks REDUCE 87% of the time,
  which is degenerate. The no-trajectory ablation scores 3.74.
- In the app, `/api/adaptive-replan` normalises the state as
  `[completion, sleep/10, injury_flag, trajectory/2, streak/14]`.
- Code safety layers already override the policy:
  - INCREASE becomes MAINTAIN when the check-in notes mention pain;
  - `limitProgression` caps volume;
  - injury stripping applies.

**What to do**
1. Audit the environment:
   - transitions, reward and termination;
   - whether rewards push toward safe, goal-oriented changes (fatigue, injury risk rising with
     load spikes, churn when underloaded);
   - why PPO collapses to REDUCE.
2. **Calibrate transitions with real data wherever possible:**
   - workload → injury relationships from the Model 3 dataset (e.g. acute:chronic ratio);
   - progression rates from the Model 4 data;
   - FitFusion completion distributions, but only from **real, non-seeded** users.

   Label everything else as assumptions.
3. **Make safety constraints hard**, not learned: action masking or a post-filter so INCREASE is
   impossible when there's an injury flag or pain. Document it.
4. Train PPO with a recorded config and seeds. Save checkpoints, TensorBoard or CSV logs, and a
   learning curve. Check convergence across 3+ seeds.
5. Evaluate on **independent** evaluation scenarios (different seeds and scenario mix) over 500
   episodes vs the rule-based thresholds and vs MAINTAIN-always. Report mean reward with CIs,
   injury events, churn and the action distribution. All of this is **simulated**; say so.
6. Integrate only if it beats the rule baseline with a pre-registered rule; otherwise keep the
   rules and present PPO as evidence (the same approach as Models 1 and 2). Validate app inputs.
7. Teacher folder `demos/model5_rl/`. The demo loads the agent, shows a sample state and the
   chosen action, plus reward curves, the policy comparison plot and the environment
   explanation. Then tests, docs, commit, report, and ask before Phase 6.

### 3.4 Phase 6: integration and deployment (after Model 5)
1. **ML service hosting.**
   - `render.yaml` (free plan) builds from git, but `models/*` is gitignored, so **Render has no
     artifacts**.
   - Propose a strategy (e.g. Git LFS, a download step at build time from a GitHub Release or
     storage bucket, or a Render disk) and explain the trade-offs. Note that torch plus the 83 MB
     hybrid artifact may exceed free-tier RAM (512 MB).
   - Ask me before creating accounts or changing settings.
2. **Vercel production has no `ML_SERVICE_URL` / `ML_SERVICE_API_KEY`**, so production always uses
   fallbacks. I set these myself; give me the exact steps.
3. **Production runs `main`**, which ends at PR #8. All this work is on `feat/ml-intelligence-layer`.
   Merging, or opening a PR, is my call: ask.
4. End-to-end checks:
   - schema compatibility of every Next→ML call;
   - the fallbacks fire with the service down;
   - the LLM consumes model outputs (meals, exercises, calories, injury, trajectory, RL action)
     rather than inventing them;
   - RLS and user isolation;
   - signed-in flows tested via Chrome.
5. A final demo guide across all five models in a predictable order. Update
   `docs/viva-presentation-guide.html` and `docs/ml-implementation-report.html`: both still
   describe the OLD models.

### 3.5 Remaining QA report items (not ML; do them in Phase 6 or when I ask)

**Data-consistency bugs:**
- Ticking 2 exercises creates 2 workout sessions.
- "Monday Already Completed" shows after only 2 of 4 exercises.
- The streak differs between pages (1 vs 0).
- Workout days show 5 vs 7 (rest days counted).
- Home shows weight "--" after onboarding.
- `profiles.weight` is an **integer** column, so 72.5 becomes 72; this needs a migration, so ask.
- Water: Home 0.50 L vs Today 0.25 L.
- Calories eaten differ between Today and the Diet tab.
- The Diet tab shows 0 g carbs and fat for plan meals, and Snack is filed under Lunch.
- Plan burn doesn't update after "Modify with AI".
- Profile shows blank workout time and rest days, and has no gender field.
- The greeting uses the email prefix instead of the name.
- There are two separate achievement systems.
- Plan History shows UTC times.

**UX polish:**
- developer text visible to users;
- the onboarding progress bar doesn't move back with Back;
- "Meal in progress" isn't cleared after saving;
- the Plan & AI layout is cramped at about 1,050 px;
- meal-type chips are truncated;
- Today's meals show slot names, not food;
- Tools → TDEE isn't pre-filled from the profile;
- Dream Body shows a day-count mismatch and ignores the vegetarian diet and the knee injury;
- achievements assume weight loss and start at Level 0;
- grammar: "1 days" / "1 sessions";
- Habits shows 14% on day one;
- Workout Help needs scroll-to-results;
- analytics shows predictions after only 2 sessions;
- accessibility: the sidebar uses buttons instead of links, and icon buttons lack labels;
- Home jumps back to the top after tapping water.

**Test data to clean, with my approval:** the QA account's plans 1–4, a vitals entry of
−1900/−15, and other QA rows.

### 3.6 Manual steps waiting on me (ask when relevant)
1. Approve and apply `20261026_input_range_checks.sql` (the Supabase MCP can apply it once I say
   yes).
2. Approve deleting QA test data.
3. Set Vercel env vars and choose ML hosting (Phase 6).
4. Decide whether to merge or open a PR to `main`.
5. Delete local archives (`web.zip`, `web/src.zip`, `web/src (2).zip`,
   `web/fitfusion-ai-wb.zip`) and the leftover `myApp/node_modules`.
6. Decide on the worktree `web/fitfusion-ai-wb/intelligent-nobel-47c098`: it has **uncommitted
   edits** to 5 dashboard pages.
7. Decide on the untracked `build_report.py` (it writes to my Desktop) and
   `web/datasets/exercises.json` (30 ExerciseDB samples).
8. Confirm Worcestershire sauce = non-vegetarian (it contains anchovies; the code assumes yes).
9. Optional: test the Cardio tab and plan generation signed in. You can do this via Chrome.

---

## 4. How to train and run what exists (from `ml-service\`)

```powershell
# setup (once)
py -3.11 -m venv .venv ; .venv\Scripts\pip install -r requirements.txt

# Model 1 — calorie
.venv\Scripts\python.exe -m training.train_calorie_hr               # ~1.5 min
.venv\Scripts\python.exe -m training.calibrate_calorie_hr           # ~10 s, writes calorie_energy.json
.venv\Scripts\python.exe -m training.train_calorie_gym_comparison   # slide design, comparison only
.venv\Scripts\python.exe demos\model1_calorie\demo.py [--samples]

# Model 2 — recommender
.venv\Scripts\python.exe -m training.data_foodcom                   # flags + splits (~2 min)
.venv\Scripts\python.exe -m training.build_meal_catalog
.venv\Scripts\python.exe -m training.train_meal_hybrid              # ~1.5 h, run alone
.venv\Scripts\python.exe -m training.build_meal_hybrid_serving
.venv\Scripts\python.exe -m training.build_meal_hybrid_serving --cutoff 2018-01-01 --out meal_hybrid_demo.pkl
.venv\Scripts\python.exe -m training.build_exercise_index
.venv\Scripts\python.exe demos\model2_recommender\demo.py

# Models 3–5 (OLD versions, to be redone)
.venv\Scripts\python.exe -m training.train_injury
.venv\Scripts\python.exe -m training.train_transformer
.venv\Scripts\python.exe -m training.train_rl_agent
.venv\Scripts\python.exe -m training.export_pilot_data              # needs SUPABASE env vars

# service + tests
$env:ML_SERVICE_API_KEY="local-demo"; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
.venv\Scripts\python.exe -m pytest -q
```

**Data locations** (gitignored, under `ml-service/data/`):
- `malaga/`, `weee/dataset/`, `gym_members_exercise_tracking.csv`;
- `foodcom/` (RAW_recipes.csv, RAW_interactions.csv) and `processed/`;
- `exercises/` (free-exercise-db with LICENSE.md and SOURCE_COMMIT.txt);
- `food.csv` (unused);
- `pilot/`.

**Web app:** `cd web && npm run dev`. `.env.local` needs `ML_SERVICE_URL=http://localhost:8000` and
a matching `ML_SERVICE_API_KEY`.

---

## 5. Key files map

**ML service:**
- `app/main.py`, `auth.py`, `config.py`, `schemas.py`;
- `model_registry.py` (loads every artifact; `/healthz` reports `models_status`);
- `features.py`, `energy.py`, `calorie_model.py`, `meal_hybrid.py`, `exercise_recommender.py`,
  `rl_env.py`, `trajectory_model.py`, `supabase_reader.py`;
- routers: `calorie.py`, `recommend.py`, `exercise.py`, `injury.py`, `trajectory.py`,
  `rl_action.py`.

**Web:**
- `src/lib/ml-service/`: `client.ts` (2 s timeout + fallback), `index.ts` (wrappers), `types.ts`,
  `history.ts` (shared week read), `injury-rules.ts`, `profile.ts`, `meal-history.ts`;
- `src/app/api/`: `adaptive-replan`, `generate-plan`, `workout-log`, `ml-insights`;
- `src/lib/`: `meal-targets.ts`, `plan-structure.ts`, `validation.ts`, `groq-json.ts`,
  `groq-model.ts`, `supabase/require-user.ts`;
- `src/proxy.ts`.

**Reports** (committed): `ml-service/models/reports/*.json` and `*.png`.

---

## 6. Completion report format (end of every model)

1. What you inspected.
2. What you changed.
3. Dataset and source.
4. Exact record counts.
5. Algorithm and config.
6. Actual metrics vs baselines and targets.
7. Exact train and run commands.
8. Files created or modified.
9. Tests and their results.
10. How to present it.
11. Limitations and manual steps.
12. Whether it passes the checklist:
    - **data and training:** verified source, reproducible prep, no leakage, saved artifacts;
    - **inference:** loads, validates input, documented output, tests, no hardcoded predictions;
    - **evaluation:** proper metrics, baselines, targets stated honestly, outputs saved;
    - **teacher folder:** complete.
13. Status: **verified working / partially working / blocked**, with the evidence.
14. Ask for approval before the next model.

---

## 7. Where to start

1. Read `CLAUDE.md`. Check `git status` and `git log -5`; expect `4cd07fb` or later on
   `feat/ml-intelligence-layer`.
2. Run `pytest -q` to confirm 193 pass.
3. **Start Model 3 with a short audit plus a dataset search** (§3.1 step 1). Present the candidate
   injury datasets, with verified links, licences, label types and what each would let us claim.
   Ask me which to use before downloading or training.
