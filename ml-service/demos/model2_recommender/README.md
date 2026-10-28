# Model 2 — hybrid fitness and nutrition recommender (teacher demo)

Model 2 has two parts.

**Meals: a hybrid recommender** (popularity + collaborative filtering + content).
- It ranks real Food.com recipes for each meal slot by
  `0.5·popularity + 0.25·ALS + 0.25·ingredient TF-IDF cosine`.
- It works inside the user's dietary rules and the calorie band of each meal.
- It's personalised from the plan recipes the user has eaten. New users get popularity.
- On a pre-registered test it beat popularity by 19% (Recall@10, CI above zero).

**Exercises: a content-based recommender** (cosine similarity).
- It ranks 876 public-domain exercises for a session (push, pull, legs, core and others) by the
  goal, training style and level.
- It runs after hard filters for equipment, injuries, level and target muscles.
- It's content-only, because no exercise preference data exists.

Both feed `/api/generate-plan`: the LLM writes the plan from the recommended recipes and exercises
instead of inventing them.

| File | Contents |
|---|---|
| `DATA_SOURCES.md` | datasets: links, licences, counts, cleaning, why the slide datasets weren't used |
| `RESULTS.md` | protocol, every metric, baselines, targets met or not, limitations |
| `demo.py` | the demonstration (8 sections, all computed live) |
| `sample_profile.json` | the labelled example profile |
| `outputs/demo_output.txt` | the actual output of `demo.py` |
| `outputs/sample_recommendations.json` | the same results as JSON (meals, exercises, the held-out user) |
| `outputs/test_results.txt` | 130 Model 2 tests and their results |

Code, kept where the service uses it:

| Path | Role |
|---|---|
| `training/data_foodcom.py` | load Food.com, compute dietary flags, define the time splits |
| `training/train_meal_hybrid.py` | tune the weights on 2012–13, rolling test 2014–17, decision |
| `training/build_meal_hybrid_serving.py` | build the serving artifact (and the pre-2018 demo artifact) |
| `training/build_meal_catalog.py` | build the filtered serving catalog |
| `training/build_exercise_index.py` | build and evaluate the exercise recommender |
| `app/meal_hybrid.py`, `app/routers/recommend.py` | hybrid inference, `POST /recommend` |
| `app/exercise_recommender.py`, `app/routers/exercise.py` | exercise inference, `POST /recommend/exercises` |
| `web/src/lib/ml-service/meal-history.ts` | turns plan meals marked eaten into recipe history |
| `tests/test_model2_meals.py`, `test_model2_exercises.py`, `test_meal_data.py` | the tests |

## 1. Setup (Windows, from `ml-service\`)

```powershell
cd ml-service
.venv\Scripts\pip install -r requirements.txt      # skip if Model 1 already works
```

**Data** (see `DATA_SOURCES.md`; only needed to rebuild):
- Food.com CSVs go in `data\foodcom\`.
- The exercises:

```powershell
mkdir data\exercises
curl.exe -L https://raw.githubusercontent.com/yuhonas/free-exercise-db/f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5/dist/exercises.json -o data\exercises\exercises.json
```

## 2. Run the demonstration

```powershell
.venv\Scripts\python.exe demos\model2_recommender\demo.py
```

It takes about a minute and prints:
1. The loaded artifacts.
2. The example profile and its calorie targets.
3. **Top-5 meals per slot for a new user** (popularity).
4. **Top-5 meals per slot with eating history** (the hybrid), with each signal's share of the score.
5. **Top-5 exercises** for push, pull, legs and core, with the reason for each pick.
6. How the lists change when the diet, injury or training style changes.
7. **The hybrid on a real held-out Food.com user**: their past likes, hybrid vs popularity top-10,
   and ✓ on recipes they really liked later.
8. The evaluation numbers.

To show it responding live, edit `sample_profile.json` (diet, goal, injuries, training style, the
example history) and run it again. You can also pass your own file:
`demo.py my_profile.json`.

## 3. Rebuild from scratch

```powershell
.venv\Scripts\python.exe -m training.data_foodcom                  # ~2 min   flags + splits
.venv\Scripts\python.exe -m training.build_meal_catalog            # ~1 min   serving catalog
.venv\Scripts\python.exe -m training.train_meal_hybrid             # ~1.5 h   tuning + rolling test + decision
.venv\Scripts\python.exe -m training.build_meal_hybrid_serving     # ~3 min   serving artifact
.venv\Scripts\python.exe -m training.build_meal_hybrid_serving --cutoff 2018-01-01 --out meal_hybrid_demo.pkl
.venv\Scripts\python.exe -m training.build_exercise_index          # ~1 min   exercises + evaluation
```

Seeds are fixed (`RANDOM_SEED = 42`). Don't run the hybrid evaluation alongside other heavy jobs:
it needs about 4 GB of RAM.

## 4. Tests

```powershell
.venv\Scripts\python.exe -m pytest tests\test_model2_meals.py tests\test_model2_exercises.py tests\test_meal_data.py -v
```

## 5. Through the API

```powershell
$env:ML_SERVICE_API_KEY = "local-demo"; .venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
# second window:
curl.exe -X POST http://127.0.0.1:8000/recommend/exercises -H "Authorization: Bearer local-demo" -H "Content-Type: application/json" -d "{\"focus\":\"legs\",\"goal\":\"Muscle Gain\",\"training_style\":\"Gym\",\"activity_level\":\"Moderately Active\",\"injuries\":[\"knee\"]}"
curl.exe -X POST http://127.0.0.1:8000/recommend -H "Authorization: Bearer local-demo" -H "Content-Type: application/json" -d "{\"meals\":[{\"slot\":\"dinner\",\"kcal_target\":877}],\"dietary_restrictions\":[\"vegetarian\"],\"liked_recipe_ids\":[]}"
```

In the app, generate a plan from Plan & AI with the ML service running. The plan's meals come from
`/recommend`, and `meta.exercise_recommender.options` records the suggested exercises. After a few
days of ticking meals as eaten on the Today page, a new plan uses the hybrid
(`meta.meal_recommender.cold_start` = false).

## Response formats

**`POST /recommend`**
- Request: `liked_recipe_ids` (up to 500).
- Per meal: the calorie band, whether it was `widened`, and the recipes. Each recipe has `kcal`,
  `protein_g`, `likes_last_year` and `score_breakdown` (popularity, als, text).
- Response level: `method`, `cold_start`, `history_used`, and the applied and unsupported
  restrictions.

**`POST /recommend/exercises`**
- Request: `focus`, `goal`, `training_style`, `activity_level`, `injuries`, `equipment` and `k`.
- Response: `recommendations`, each with `score` (the cosine similarity) and `why`.
- Also returned: `excluded_counts` (how many exercises each filter removed),
  `candidates_after_filters`, and `note` when the list is short.

## Limitations

- The absolute numbers are small: Recall@10 is 0.0235 and Precision@5 is 0.0039. **The slides'
  70% Precision@5 is not met**; `RESULTS.md` explains why that figure isn't achievable with real
  labels.
- Users with a single like gain nothing over popularity.
- **Real FitFusion users are cold-start today.** Only 1 of 211 plans in the live database (checked 2026-10-28) carries recipe IDs, because recipe-backed plans ship with this branch. Personalisation starts once users get recipe-backed plans and mark meals as eaten.
- Food.com recipes are mostly American; Indian dishes are about 1% of the catalog.
- The exercise half has no preference data. Its metrics check rules and goal fit, not whether
  users like the exercises.
