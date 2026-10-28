# Model 2 — data sources

Raw files live in `ml-service/data/`, which is gitignored; download them with the links below.
Pages were re-checked on **2026-10-28**. Food.com was downloaded on 2026-09-16 and
free-exercise-db on 2026-10-28.

---

## 1. Meals — Food.com Recipes and Interactions (served: hybrid recommender)

| | |
|---|---|
| Title | Food.com Recipes and Interactions |
| Publisher | Kaggle, owner Shuyang Li (v2, updated 2019-11-08). Paper: Majumder et al., *Generating Personalized Recipes from Historical User Preferences*, EMNLP 2019 |
| URL | https://www.kaggle.com/datasets/shuyangli94/food-com-recipes-and-user-interactions |
| Licence | Kaggle lists "Data files © Original Authors": the recipes and reviews remain the Food.com authors' content. Used here for non-commercial research and teaching, with attribution. |
| Type | **Real public user activity**: Food.com recipes plus star ratings and reviews (2000–2018) |
| Files used | `RAW_recipes.csv` (231,637 recipes: name, minutes, tags, nutrition, ingredients); `RAW_interactions.csv` (1,132,367 interactions: user_id, recipe_id, date, rating, review). The CSV has 1,327,042 lines because reviews contain line breaks. |
| Loader | `training/data_foodcom.py` writes `data/processed/foodcom_recipes.pkl` and `foodcom_likes.pkl` |

**Interaction data used for collaborative filtering**
- Ratings of 0 are reviews without a rating and are dropped. Ratings of 1–3 are not likes. A
  **like = 4 or 5 stars**.
- That gives **1,003,724 likes from 180,310 users on 217,565 recipes**, 2000-01-25 to 2018-12-20.

**Item features (content)**
- TF-IDF over ingredients and tags: 8,493 terms, minimum document frequency 5.
- Nutrition per serving: kcal, protein, fat, sugar, sodium, saturated fat and carbs, as given by
  Food.com in %DV and converted to grams of protein. Nutrition was evaluated as a fourth signal and
  given weight 0 by validation.

**Cleaning**
- *Recommendable* recipes are those with a name and between 20 and 2,000 kcal per serving:
  223,029.
- The serving catalog also drops condiments and components, leaving 98,325 recipes. Popularity
  there is computed over 2017-12-20 to 2018-12-20.

**Dietary flags (a safety feature)**
- Every recipe is checked ingredient by ingredient against meat, dairy, egg, gluten, nut and honey
  rules. The recipe name is a second guard, for meat (Food.com sometimes omits the protein from the
  ingredient list) and, since 2026-10-28, for egg.
- **Vegetarian = no meat and no egg**, because FitFusion offers "Eggetarian" separately. 79,069
  recommendable recipes qualify. Eggetarian means no meat (eggs allowed). Vegan also excludes dairy,
  egg and honey: 31,767 recipes.
- The dataset's own "vegetarian" tag is unreliable: 8,568 of 35,651 recipes with that tag contain
  meat, fish or egg.
- Two manual audits of 50 vegetarian-flagged recipes each checked for meat: 47/50 correct before
  the plural fix, then 50/50 after it.
- Every miss found in live testing has a regression test in `tests/test_meal_data.py`, including
  rump roast, gorgonzola served as vegan, ditalini served as gluten-free, and "Parsee Eggs" served
  to a vegetarian.
- A restriction the flags cannot verify (halal, kosher, pescatarian, low sodium) returns **no**
  recipes.

**Limitations**
- Food.com users are mostly from the US, and only 1.2% of recipes carry the "indian" tag.
- 71% of users have only one like, which makes them cold-start users.
- Ratings say whether a user liked a recipe, not whether they would cook it as part of a fitness
  plan.

---

## 2. Exercises — free-exercise-db (served: content-based exercise recommender)

| | |
|---|---|
| Title | free-exercise-db: "Open Public Domain Exercise Dataset in JSON format, over 800 exercises" |
| Publisher | GitHub `yuhonas/free-exercise-db`, restructured from Ollie Jennings's `exercises.json` dataset (wrkout/exercises.json) |
| URL | https://github.com/yuhonas/free-exercise-db (file `dist/exercises.json`) |
| Version | Pinned to commit `f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5` (2026-09-27); SHA-256 of the file `5bb747e3…40bf` |
| Licence | **Unlicense, public domain** (`LICENSE.md` saved next to the data) |
| Type | Public reference data: exercise descriptions, with no user records |
| Records | **876 exercises.** Fields: name, force, level, mechanic, equipment, primaryMuscles, secondaryMuscles, instructions, category, images |
| Item features | One-hot primary muscles (weight 1.0), secondary muscles (0.4), equipment, level, category, mechanic and force: 44 features |
| Quality notes | equipment is missing for 77 exercises, mechanic for 87 and force for 30. 5 exercises have no instructions. There are no duplicate names. Levels: 525 beginner, 294 intermediate, 57 expert. |
| Script | `training/build_exercise_index.py` writes `models/exercise_index.pkl` |

**Why content-based only.** No dataset records which exercises people preferred, so collaborative
filtering would need interactions that don't exist.

---

## 3. Datasets named in the slides, checked and not used

| Slide dataset | What the files contain | Why not used |
|---|---|---|
| Gym Members Exercise Dataset (Kaggle `valakhorasani/gym-members-exercise-dataset`, Apache 2.0) | 973 rows, one per gym member | No user–item interactions, so it can't support collaborative filtering. Model 1 also showed its labels are formula-like. |
| "Food Nutrition dataset, 8,789 foods" (Kaggle `shrutisaxena/food-nutrition-dataset`, "Data files © Original Authors", v2 2021-07-29) | **7,413** rows × 48 nutrient columns (USDA-style codes), not 8,789 | A nutrient table with no users or recipes to recommend. Food.com has nutrition **and** real interactions. |
| FitFusion's own meal logs (Supabase `meal_items` + `meal_logs`, read as aggregates only on 2026-10-28) | 3,733 item rows from 32 users, but only **39 distinct foods**, and **99.7% were plan-assigned** | These record what the plan assigned, not what users preferred. They feed the hybrid at serving time as history (eaten plan recipes), not as training data. |

No private FitFusion records are shown in the demo or stored in this folder.
