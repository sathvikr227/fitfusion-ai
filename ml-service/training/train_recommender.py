"""Model 2 — Hybrid diet + workout recommender (collaborative + content-based).

Collaborative half: StandardScaler over [Age, BMI, Workout_Frequency,
Experience_Level], then cosine similarity against the 973-user matrix at
inference — no iterative training, exactly as the guide specifies.

Content half: a compact food index built from the Food Nutrition Dataset, with
goal-driven ranking and hard filters for dietary restrictions and injuries.

    .venv/Scripts/python.exe -m training.train_recommender
"""

from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.preprocessing import StandardScaler

from app.features import (
    COL_WORKOUT_TYPE,
    FOOD_COL_CARBS,
    FOOD_COL_CATEGORY,
    FOOD_COL_DESCRIPTION,
    FOOD_COL_FAT,
    FOOD_COL_KCAL,
    FOOD_COL_PROTEIN,
    RECOMMENDER_FEATURES,
    WORKOUT_TYPE_NAMES,
)
from training.common import (
    MODEL_DIR,
    banner,
    ensure_dirs,
    load_food_dataset,
    load_gym_dataset,
    write_report,
)

SCALER_ARTIFACT = "rec_scaler.pkl"
MATRIX_ARTIFACT = "user_matrix.pkl"
FOOD_ARTIFACT = "food_index.pkl"

TOP_K_NEIGHBOURS = 10  # doc: "Select top-10 most similar users"

# Keywords that disqualify a food under a dietary restriction, matched against
# the dataset's Category + Description text.
#
# The lists are composed from groups rather than written out per restriction:
# an enumerated per-diet list is how "Seal, Bearded (Oogruk), Meat, Raw" slips
# past a vegetarian filter. The generic terms ("meat", "flesh", offal) are what
# catch the long tail of animal foods in the USDA data.

_LAND_MEAT = [
    "beef", "pork", "chicken", "turkey", "lamb", "veal", "mutton", "goat",
    "bacon", "sausage", "ham", "frankfurter", "salami", "pepperoni", "prosciutto",
    "poultry", "duck", "goose", "quail", "pheasant", "ostrich", "emu", "squab",
    "rabbit", "venison", "deer", "elk", "moose", "caribou", "bison", "buffalo",
    "boar", "seal", "whale", "walrus", "beluga", "muskrat", "beaver", "bear",
    "game meat", "meat", "flesh", "lard", "tallow", "suet", "gelatin",
    "liver", "kidney", "tripe", "sweetbread", "tongue", "brain", "giblet",
    "blood sausage", "headcheese", "pate",
]

_SEAFOOD = [
    "fish", "salmon", "tuna", "cod", "halibut", "trout", "tilapia", "haddock",
    "mackerel", "herring", "anchovy", "sardine", "catfish", "bass", "perch",
    "pollock", "snapper", "sole", "flounder", "swordfish", "eel", "caviar", "roe",
    "shrimp", "prawn", "crab", "lobster", "clam", "oyster", "mussel", "scallop",
    "squid", "octopus", "mollusk", "crustacean", "shellfish", "surimi",
    # The USDA set carries a long tail of aquatic animals that a short list
    # misses — these are what let "Sea Cucumber" read as vegetarian.
    "sea cucumber", "sea urchin", "abalone", "conch", "whelk", "cockle",
    "cuttlefish", "krill", "jellyfish", "snail", "escargot", "frog", "turtle",
    "alligator", "crocodile", "crayfish", "crawfish", "langostino", "cisco",
]

_DAIRY = ["milk", "cheese", "butter", "yogurt", "yoghurt", "cream", "whey", "custard", "ghee", "kefir"]
_EGG = ["egg"]
_GLUTEN = [
    "wheat", "bread", "pasta", "barley", "rye", "cracker", "cereal", "flour",
    "noodle", "bagel", "biscuit", "cake", "cookie", "pretzel", "couscous",
    "semolina", "farina", "bulgur", "seitan", "crouton",
]
_NUTS = ["peanut", "almond", "cashew", "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "brazilnut"]
_ALCOHOL = ["alcohol", "wine", "beer", "liquor", "rum", "vodka", "whiskey", "brandy"]

# Plant foods, used as an ALLOW-list for the diets where a leak is unacceptable.
#
# A blocklist cannot be made safe here: the USDA table carries thousands of
# animal foods under names no keyword list anticipates ("Ling", "Sea Cucumber",
# "Oogruk"), and each leak puts meat in front of a vegetarian. For those diets
# the filter is inverted — keep only what is recognisably plant-based (plus
# dairy and eggs where the diet allows), and drop anything unrecognised. Missing
# a valid food is a much cheaper error than recommending fish to a vegetarian.
_PLANT_FOODS = [
    "soy", "tofu", "tempeh", "edamame", "seitan", "bean", "lentil", "pea",
    "chickpea", "garbanzo", "hummus", "falafel", "peanut", "almond", "cashew",
    "walnut", "pecan", "pistachio", "hazelnut", "macadamia", "nut", "seed",
    "sesame", "tahini", "chia", "flax", "hemp", "sunflower", "pumpkin",
    "quinoa", "amaranth", "buckwheat", "oat", "barley", "rice", "wheat",
    "bulgur", "millet", "sorghum", "teff", "rye", "corn", "maize", "bread",
    "pasta", "noodle", "cereal", "flour", "potato", "yam", "cassava", "taro",
    "mushroom", "spinach", "kale", "broccoli", "cauliflower", "cabbage",
    "lettuce", "carrot", "tomato", "pepper", "onion", "garlic", "squash",
    "zucchini", "cucumber", "celery", "asparagus", "artichoke", "beet",
    "turnip", "radish", "okra", "eggplant", "avocado", "olive", "apple",
    "banana", "orange", "berry", "grape", "melon", "mango", "papaya",
    "pineapple", "peach", "pear", "plum", "cherry", "apricot", "fig", "date",
    "raisin", "coconut", "spirulina", "nutritional yeast", "seaweed", "nori",
    "kelp", "vegetable", "fruit", "juice", "vegetarian", "veggie", "meatless",
    "plant",
]
_DAIRY_AND_EGG = _DAIRY + _EGG + ["paneer", "casein", "cottage"]

# Diets where the filter is inverted. Value = the allowed keyword list.
RESTRICTION_ALLOWLIST: dict[str, list[str]] = {
    "vegetarian": _PLANT_FOODS + _DAIRY_AND_EGG,
    "eggetarian": _PLANT_FOODS + _DAIRY_AND_EGG,
    "vegan": _PLANT_FOODS,
}

RESTRICTION_BLOCKLIST: dict[str, list[str]] = {
    "vegetarian": _LAND_MEAT + _SEAFOOD,
    "vegan": _LAND_MEAT + _SEAFOOD + _DAIRY + _EGG + ["honey"],
    "eggetarian": _LAND_MEAT + _SEAFOOD,
    "pescatarian": _LAND_MEAT,
    "dairy_free": _DAIRY,
    "lactose_free": _DAIRY,
    "gluten_free": _GLUTEN,
    "nut_free": _NUTS,
    "halal": ["pork", "bacon", "ham", "lard", "gelatin", "boar"] + _ALCOHOL,
    "kosher": ["pork", "bacon", "ham", "lard", "boar"] + [
        "shellfish", "shrimp", "prawn", "crab", "lobster", "clam", "oyster",
        "mussel", "scallop", "squid", "octopus",
    ],
    "low_sodium": ["salted", "with salt", "cured", "brine", "pickled"],
}

# Workout types to withhold when a muscle group is injured.
INJURY_WORKOUT_BLOCKLIST: dict[str, list[str]] = {
    "knee": ["HIIT"],
    "back": ["Strength", "HIIT"],
    "shoulder": ["Strength"],
    "hamstring": ["HIIT"],
}


def build_user_matrix(df: pd.DataFrame) -> tuple[StandardScaler, np.ndarray]:
    # Fit on the raw array so the scaler records no column names — serving passes
    # a plain numpy row, and a name-carrying scaler warns on every request.
    features = df[RECOMMENDER_FEATURES].astype(float).to_numpy()
    scaler = StandardScaler().fit(features)
    return scaler, scaler.transform(features)


def recommend_workouts(
    vector: np.ndarray,
    matrix: np.ndarray,
    workout_types: list[str],
    top_k: int = 3,
    neighbours: int = TOP_K_NEIGHBOURS,
) -> list[tuple[str, float]]:
    """Top-K workout types among the most similar users, scored by share."""
    sims = cosine_similarity(vector.reshape(1, -1), matrix)[0]
    idx = np.argsort(sims)[::-1][:neighbours]
    counts: dict[str, float] = {}
    for i in idx:
        counts[workout_types[i]] = counts.get(workout_types[i], 0.0) + 1.0
    total = sum(counts.values()) or 1.0
    ranked = sorted(
        ((name, count / total) for name, count in counts.items()),
        key=lambda kv: kv[1],
        reverse=True,
    )
    return ranked[:top_k]


def build_food_index(food: pd.DataFrame) -> pd.DataFrame:
    """Compact, deduplicated macro table used for the content-based half."""
    cols = {
        FOOD_COL_CATEGORY: "category",
        FOOD_COL_DESCRIPTION: "description",
        FOOD_COL_KCAL: "calories",
        FOOD_COL_PROTEIN: "protein",
        FOOD_COL_CARBS: "carbs",
        FOOD_COL_FAT: "fat",
    }
    missing = [c for c in cols if c not in food.columns]
    if missing:
        raise KeyError(f"Food dataset is missing expected columns: {missing}")

    idx = food[list(cols)].rename(columns=cols).copy()
    for numeric in ("calories", "protein", "carbs", "fat"):
        idx[numeric] = pd.to_numeric(idx[numeric], errors="coerce")

    idx = idx.dropna(subset=["calories", "protein", "carbs", "fat"])
    idx = idx[idx["calories"] > 0]
    idx = idx.drop_duplicates(subset=["description"]).reset_index(drop=True)

    # Per-100g protein density drives the muscle-gain ranking; calorie density
    # drives weight loss. Precomputed so serving stays a sort, not a scan.
    idx["protein_density"] = idx["protein"] / idx["calories"] * 100.0
    idx["searchable"] = (
        idx["category"].astype(str).str.lower() + " " + idx["description"].astype(str).str.lower()
    )

    # USDA descriptions lead with the food's identity and qualify it afterwards:
    # "Roughy,Orange,Raw" is a fish, not citrus. Allow-list matching runs against
    # this leading segment only, so a qualifier can never make a food look like
    # something it is not.
    idx["primary_name"] = (
        idx["description"].astype(str).str.lower().str.split(",").str[0].str.strip()
    )
    return idx


def evaluate(df: pd.DataFrame, scaler: StandardScaler, matrix: np.ndarray) -> dict:
    """Leave-one-out Precision@K, coverage, and diversity on the real dataset."""
    workout_types = df[COL_WORKOUT_TYPE].tolist()
    features = scaler.transform(df[RECOMMENDER_FEATURES].astype(float).to_numpy())

    hits = {1: 0, 2: 0, 3: 0}
    covered = 0
    distinct_counts: list[int] = []

    for i in range(len(df)):
        # Exclude the held-out user so we never score against their own row.
        mask = np.ones(len(df), dtype=bool)
        mask[i] = False
        ranked = recommend_workouts(
            features[i],
            matrix[mask],
            [t for j, t in enumerate(workout_types) if mask[j]],
            top_k=len(WORKOUT_TYPE_NAMES),
        )
        names = [name for name, _ in ranked]
        if names:
            covered += 1
        distinct_counts.append(len(set(names[:3])))
        for k in hits:
            if workout_types[i] in names[:k]:
                hits[k] += 1

    n = len(df)
    return {
        "precision_at_1": hits[1] / n,
        "precision_at_2": hits[2] / n,
        "precision_at_3": hits[3] / n,
        "coverage": covered / n,
        "diversity_distinct_types_in_top3": float(np.mean(distinct_counts)),
        "note": (
            "The dataset has only 4 workout classes, so Precision@5 as written in "
            "the guide is degenerate (it would always be 1.0). Precision@1..3 is "
            "reported instead, leave-one-out over all 973 users."
        ),
    }


def main() -> None:
    banner("Model 2 — Hybrid diet + workout recommender")
    ensure_dirs()

    gym = load_gym_dataset()
    scaler, matrix = build_user_matrix(gym)
    workout_types = gym[COL_WORKOUT_TYPE].tolist()

    metrics = evaluate(gym, scaler, matrix)
    print(f"\n  Precision@1 : {metrics['precision_at_1']:.3f}")
    print(f"  Precision@2 : {metrics['precision_at_2']:.3f}")
    print(f"  Precision@3 : {metrics['precision_at_3']:.3f}")
    print(f"  Coverage    : {metrics['coverage']:.3f}")
    print(f"  Diversity   : {metrics['diversity_distinct_types_in_top3']:.2f} distinct types in top-3")

    food = load_food_dataset()
    food_index = build_food_index(food)
    print(f"\n  Food index: {len(food_index)} usable items across "
          f"{food_index['category'].nunique()} categories")

    joblib.dump(
        {
            "scaler": scaler,
            "feature_names": RECOMMENDER_FEATURES,
            "model_version": "recommender-hybrid-v1",
        },
        MODEL_DIR / SCALER_ARTIFACT,
    )
    joblib.dump(
        {
            "matrix": matrix,
            "workout_types": workout_types,
            "profiles": gym[RECOMMENDER_FEATURES].to_dict("records"),
            "top_k_neighbours": TOP_K_NEIGHBOURS,
        },
        MODEL_DIR / MATRIX_ARTIFACT,
    )
    joblib.dump(
        {
            "index": food_index,
            "restriction_blocklist": RESTRICTION_BLOCKLIST,
            "restriction_allowlist": RESTRICTION_ALLOWLIST,
            "injury_workout_blocklist": INJURY_WORKOUT_BLOCKLIST,
        },
        MODEL_DIR / FOOD_ARTIFACT,
    )
    print(f"\n[artifact] {MODEL_DIR / SCALER_ARTIFACT}")
    print(f"[artifact] {MODEL_DIR / MATRIX_ARTIFACT}")
    print(f"[artifact] {MODEL_DIR / FOOD_ARTIFACT}")

    write_report(
        "recommender",
        {
            "artifacts": [SCALER_ARTIFACT, MATRIX_ARTIFACT, FOOD_ARTIFACT],
            "algorithm": "StandardScaler + cosine similarity (top-10 neighbours) + content filters",
            "datasets": {
                "workout": "valakhorasani/gym-members-exercise-dataset",
                "diet": "shrutisaxena/food-nutrition-dataset",
            },
            "user_rows": int(len(gym)),
            "food_rows_usable": int(len(food_index)),
            "food_rows_raw": int(len(food)),
            "features": RECOMMENDER_FEATURES,
            "metrics": metrics,
        },
    )


if __name__ == "__main__":
    main()
