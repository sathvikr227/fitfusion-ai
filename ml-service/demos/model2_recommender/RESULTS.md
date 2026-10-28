# Model 2 — results

Numbers are copied from these reports:
- `models/reports/meal_hybrid.json`
- `models/reports/exercise_recommender.json`
- the earlier ALS and popularity reports (`meal_recommender*.json`)

## A. Meals: hybrid recommender (served)

### Method

```
score(user, recipe) = 0.5 · popularity + 0.25 · ALS + 0.25 · TF-IDF cosine
```

| Signal | What it measures | Kind |
|---|---|---|
| popularity | Likes in the 365 days before the cutoff | non-personal prior |
| ALS | Implicit matrix factorisation: 64 factors, α 2, regularisation 1 | **collaborative filtering** |
| TF-IDF cosine | Cosine similarity between the recipe's ingredients and tags and the sum of the user's liked recipes | **content-based** |

- Each signal is min-max normalised per user over all recommendable recipes, then blended.
- Dietary and calorie filters run **before** the user sees anything, and the score never overrides
  them.
- **Cold start:** with no history, the ranking is popularity.

### Protocol (written into `train_meal_hybrid.py` before any result)

1. **Weights.** A grid of 35 weight combinations, in steps of 0.25 across popularity, ALS, text and
   nutrition, chosen on validation: trained on likes before 2012, evaluated on 2012–2013, 8,005
   users. Selected: popularity 0.5, ALS 0.25, text 0.25, nutrition 0 (Recall@10 0.0259, against
   0.0242 for popularity alone).
2. **Test.** Rolling years **2014–2017**, all after the validation window. Each year trains on all
   earlier likes, refreshes popularity, retrains ALS, and evaluates that year.
3. **Relevance label.** A recipe the user rated **4 or 5 stars in that year**. Already-liked
   recipes are excluded from the candidates.
4. **Serving rule (your choice).** Serve the hybrid only if its Recall@10 beats popularity with a
   95% confidence interval entirely above zero. The interval is a bootstrap that resamples users,
   because a user can appear in several years.

### Test results: 9,146 user-years, 6,610 users

| Method | Recall@10 | Precision@5 | NDCG@10 |
|---|---|---|---|
| **Hybrid (served)** | **0.0235** | **0.0039** | **0.0130** |
| Popularity (previous method) | 0.0198 | 0.0033 | 0.0106 |
| ALS alone | 0.0151 | 0.0034 | 0.0090 |
| Content: ingredients alone | 0.0007 | 0.0002 | 0.0005 |
| Content: nutrition alone | 0.0002 | 0.0000 | 0.0001 |

| Comparison | Difference | 95% CI |
|---|---|---|
| Hybrid − popularity, Recall@10 | **+0.0037 (+19%)** | [+0.0016, +0.0057] |
| Hybrid − popularity, Precision@5 | +0.0007 (+20%) | [+0.0002, +0.0011] |
| Hybrid − ALS, Recall@10 | +0.0084 (+56%) | [+0.0058, +0.0110] |

**Decision: serve the hybrid.** The interval is entirely above zero.

**By year:**

| Year | Hybrid | Popularity |
|---|---|---|
| 2014 | 0.0172 | 0.0133 |
| 2015 | 0.0255 | 0.0227 |
| 2016 | 0.0287 | 0.0257 |
| 2017 | 0.0289 | 0.0239 |

The hybrid was ahead in all four years.

**By how much history the user had** (Recall@10):

| Prior likes | Hybrid | Popularity | Note |
|---|---|---|---|
| 1 | 0.0313 | 0.0311 | a tie: cold users gain nothing |
| 2–4 | 0.0268 | 0.0218 | |
| 5–19 | 0.0237 | 0.0183 | |
| 20+ | 0.0159 | 0.0118 | |

The gain comes from users with history, which is what a personalised model should show.

**What it means.** Neither collaborative filtering nor content beats popularity alone, but blended
together they do. That makes this a genuine hybrid, not content search under a misleading name.

**The slides' target: Precision@5 > 70% is not met (0.0039 measured).**
- With a real held-out label, "a recipe the user actually rated highly later out of 223,029", every
  method scores around 0.4%. A recommender can't reach 70% on this task, because a user likes only
  a handful of recipes in a year.
- A 70%-style figure would need a much easier label, such as "recipes that satisfy the user's
  rules". That measures filtering, not personal taste. Section B reports that kind of measure for
  exercises and names it as such.

**Live check in `demo.py`, section 7.** A demo model trained only on likes before 2018 and tested
on 2018 (131 users meeting a fixed rule) gives hybrid 0.0076 vs popularity 0.0075. On this small
single-year sample the two tie, which fits the cold-user pattern above. The pre-registered
2014–2017 test is the evidence.

### History from FitFusion users, at serving time

- A user's history is the set of plan recipes they marked as eaten (`web/src/lib/ml-service/meal-history.ts`).
- They are folded into ALS with the ALS user equation. `tests/test_model2_meals.py` checks this
  against the training solver.
- New users and users whose plans predate recipe IDs get popularity, the cold-start strategy.

## B. Exercises: content-based recommender (served)

There's no preference data, so these metrics check that the recommender does what it promises.
They do not measure user satisfaction. All 4,200 combinations were tested: 6 training styles × 5
goals × 4 activity levels × 7 session types × 5 injury states.

| Measure | Result | Baseline (5 random exercises passing the same filters) |
|---|---|---|
| Constraint satisfaction@5 (equipment, injury, level, target muscle) | **1.000** | — |
| Goal alignment@5 (category preferred by the goal) | **0.889** | 0.774 |
| Target-muscle precision@5 | 1.000 (a hard filter, so 1.0 by construction) | 1.000 |
| Full list of 5 returned | 3,610 / 4,200 | — |
| Catalog coverage | 22.7% of 876 exercises | — |

- **Short lists** happen only where the constraints leave few options: calisthenics pull days, and
  yoga or running push and pull days.
- **Sensitivity** (how often the list changes when one field changes): focus 1.00, style 0.86,
  goal 0.60, injuries 0.59, activity 0.57.

**Found and fixed during this phase**
- **Pullups bug.** "Pullups" didn't match the shoulder rule "pull up". Keyword matching is now
  word-boundary and gap-tolerant, and "run" no longer matches "crunch". The replan's injury rules
  have the same weakness and will be fixed in Model 3.
- **Egg leak.** Eggs reached vegetarians: "Parsee Eggs" and "Egg Foo Yung" were recommended.
  Vegetarian now excludes egg, and the recipe name is checked for eggs too.

**Limitation.** Content features can't say which of two similar exercises is better. Near-ties
such as squat vs lunge vs leg press are decided by the diversity cap (two per primary muscle),
so occasional odd picks such as "Balance Board" appear.

## Figures

- `../../models/reports/meal_hybrid_rolling.png`: Recall@10 per test year for the hybrid and each
  component.
- `../../models/reports/meal_recommender_rolling.png`: the earlier ALS vs popularity evaluation.
