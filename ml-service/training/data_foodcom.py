"""Model 2 data — Food.com recipes and ratings → catalog, liked-recipe events, splits.

Source: Majumder, Li, Ni, McAuley, "Generating Personalized Recipes from
Historical User Preferences", EMNLP 2019.
Data: https://www.kaggle.com/datasets/shuyangli94/food-com-recipes-and-user-interactions
Files used: RAW_recipes.csv, RAW_interactions.csv → extract into data/foodcom/.

Recipes
  * nutrition is [kcal/serving, fat, sugar, sodium, protein, sat. fat, carbs],
    all but kcal in % daily value. Protein grams = %DV × 0.5 (DV 50 g; checked
    against "hard boiled eggs": 12% → 6 g, one egg).
  * recipes outside 20-2000 kcal/serving are kept for learning taste but never
    recommended (`recommendable` = False).
  * dietary flags come from INGREDIENTS, not tags. The "vegetarian" tag is
    unreliable: hundreds of tagged recipes list chicken, bacon or fish.

Interactions
  * rating 0 is a review without a rating → dropped.
  * rating >= 4 is a "liked" event (72% of ratings are 5 stars, so the star
    value carries little beyond like / not like).

Splits — global date cutoffs, so no model ever sees the future:
  validation  train < 2012-01-01, evaluate 2012-01-01 .. 2013-12-31  (tuning)
  test        train < 2014-01-01, evaluate 2014-01-01 .. end          (looked at once)
Evaluation users must have at least one liked recipe before the cutoff, and
evaluation events are restricted to recommendable recipes.

    .venv/Scripts/python.exe -m training.data_foodcom
"""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass

import numpy as np
import pandas as pd

from training.common import DATA_DIR, RANDOM_SEED, banner

FOODCOM_DIR = DATA_DIR / "foodcom"
PROCESSED_DIR = DATA_DIR / "processed"
RECIPES_PATH = PROCESSED_DIR / "foodcom_recipes.pkl"
LIKES_PATH = PROCESSED_DIR / "foodcom_likes.pkl"
AUDIT_2_PATH = PROCESSED_DIR / "foodcom_vegetarian_audit_2.csv"
AUDIT_SIZE = 50

# Manual audit 1, reviewed by hand on 2026-09-16 (foodcom_vegetarian_audit.xlsx):
# 50 random recipes the filter called vegetarian; 47 truly were. The 3 misses
# ("new york strip steaks", "prime rib roast", "flank steaks") exposed that the
# keyword match ignored plurals, which is now fixed.
AUDIT_1_IDS = [
    78592, 425822, 511476, 454675, 84898, 173013, 108974, 16766, 7489, 79945, 138310, 67345,
    343513, 382930, 361680, 36698, 69121, 349187, 51930, 507166, 285503, 134514, 61617, 4684,
    92657, 229585, 436174, 23692, 79873, 180977, 187603, 305802, 20759, 398019, 202615, 137562,
    258769, 40717, 217529, 95981, 199987, 365106, 290182, 56309, 360087, 210513, 130609, 352290,
    371500, 147297,
]
AUDIT_1_MISSES = [16766, 61617, 4684]
AUDIT_1_TRUE_VEGETARIAN = 47

# Manual audit 2, reviewed by hand on 2026-09-16 (foodcom_vegetarian_audit_2.csv):
# a fresh random 50 drawn AFTER the plural fix, excluding audit 1. 50/50 truly
# vegetarian — precision >= 92.9% at 95% confidence (Wilson lower bound).
AUDIT_2_TRUE_VEGETARIAN = 50

LIKE_THRESHOLD = 4
KCAL_MIN, KCAL_MAX = 20.0, 2000.0
PROTEIN_DV_GRAMS = 50.0

VALIDATION_CUTOFFS = ("2012-01-01", "2014-01-01")
TEST_CUTOFF = "2014-01-01"

NUTRITION_COLUMNS = ["kcal", "fat_pdv", "sugar_pdv", "sodium_pdv", "protein_pdv", "satfat_pdv", "carbs_pdv"]
COURSE_TAGS = ["breakfast", "main-dish", "side-dishes", "salads", "soups-stews",
               "desserts", "appetizers", "snacks", "beverages"]

# ── ingredient keyword lists ──────────────────────────────────────────────────
# Matched on word boundaries, singular or plural ("steak" also matches "steaks"),
# after removing the phrases in *_SAFE, which name foods that contain a keyword
# without containing the thing ("peanut butter" has no dairy, "almond flour" no
# gluten, "eggplant" no egg).
#
# The plural rule came from the manual audit: 3 of 50 recipes flagged vegetarian
# listed "new york strip steaks", "flank steaks" and "prime rib roast".
MEAT = [
    "beef", "steak", "veal", "pork", "bacon", "ham", "prosciutto", "pancetta", "salami",
    "pepperoni", "chorizo", "sausage", "sausages", "bratwurst", "kielbasa", "hot dog", "hot dogs",
    "frankfurter", "chicken", "turkey", "duck", "goose", "lamb", "mutton", "goat", "venison",
    "bison", "rabbit", "meat", "meatballs", "ground round", "chuck", "sirloin", "tenderloin",
    "brisket", "rib", "ribs", "liver", "gelatin", "lard", "suet", "broth", "bouillon", "stock",
    "hamburger", "jerky", "bologna", "mortadella", "pastrami", "andouille", "capicola", "guanciale",
    "oxtail", "shank", "giblets", "gizzards", "tripe", "chitterlings", "quail", "pheasant", "hen",
    "cornish hen", "cornish game hen", "drumstick", "wings",
    "fish", "salmon", "tuna", "cod", "halibut", "tilapia", "trout", "haddock", "mackerel",
    "sardines", "anchovy", "anchovies", "catfish", "snapper", "sole", "flounder", "swordfish",
    "shrimp", "prawns", "crab", "crabmeat", "lobster", "clams", "oysters", "mussels", "scallops",
    "squid", "calamari", "octopus", "crawfish", "caviar", "fish sauce", "oyster sauce",
    "lox", "herring", "whitefish", "mahi mahi", "sea bass", "bass", "grouper", "perch", "pollock",
    "roe", "escargot", "frog legs", "clam", "oyster", "mussel", "scallop", "prawn", "sardine",
    # Found by live testing ("perfect rump roast" was served as vegetarian): cuts
    # and dishes named without the animal, and fish/fish-stock names.
    "spam", "roast", "rump", "pot roast", "filet mignon", "meatloaf", "meatloaf mix", "boston butt",
    "tri-tip", "marrow", "kangaroo", "frog's legs", "crayfish", "roughy", "basa", "hake", "monkfish",
    "pike", "walleye", "steelhead", "smelt", "eel", "shark", "sturgeon", "kipper", "fillet", "filet",
    "dashi", "bonito", "katsuobushi", "shrimp paste", "nam pla",
    # Standard Worcestershire sauce contains anchovies.
    "worcestershire",
    # Found by the name-based audit of vegetarian-flagged recipes.
    "sparerib", "fryer", "broiler", "capon", "duckling", "lardon", "liempo", "jamon", "deer", "moose",
    "elk", "buffalo", "cocktail frank", "mincemeat", "cottage roll", "kingfish", "butterfish", "pilchard",
    "sockeye", "surimi", "quahog", "bay bugs",
]
MEAT_SAFE = ["vegetable broth", "vegetable stock", "vegetable bouillon", "mushroom broth",
             "celery rib", "celery ribs", "goat cheese", "goat's cheese", "goats cheese",
             "goat milk", "goat's milk", "steak seasoning", "hot dog bun", "hamburger bun",
             "oyster cracker", "oyster mushroom", "hen of the woods",
             "dark roast", "french roast", "roast coffee", "vegetable marrow", "peppermint patties",
             "air fryer", "buffalo mozzarella", "buffalo sauce", "buffalo wing sauce",
             "vegetarian mincemeat",
             "coconut meat", "imitation bacon", "vegetable suet"]
# An ingredient carrying one of these markers is a meat substitute as a whole:
# "vegetarian ground beef" must not match on "ground beef". "imitation" is not a
# marker — imitation crab is made from fish.
MEAT_SUBSTITUTE_MARKERS = ["vegetarian", "vegan", "veggie", "meatless", "soy ",
                           "tofu", "tempeh", "seitan", "textured vegetable protein", "morningstar",
                           "boca ", "quorn"]

DAIRY = [
    "milk", "cheese", "butter", "buttermilk", "cream", "yogurt", "yoghurt", "whey", "ghee",
    "half-and-half", "parmesan", "mozzarella", "cheddar", "ricotta", "feta", "brie", "gouda",
    "romano", "provolone", "mascarpone", "custard", "ice cream", "casein", "paneer", "kefir",
]
DAIRY_SAFE = ["coconut milk", "almond milk", "soy milk", "soymilk", "rice milk", "oat milk",
              "coconut cream", "peanut butter", "almond butter", "cashew butter", "apple butter",
              "cocoa butter", "cream of tartar"]
# "non-dairy" is deliberately NOT a marker: US non-dairy creamers and whipped
# toppings usually contain casein, a milk protein that matters for allergies.
DAIRY_SUBSTITUTE_MARKERS = ["vegan", "dairy-free", "dairy free", "soy cheese"]
# Found by live testing ("pear gorgonzola salad" was served as vegan): named
# cheeses and dairy-based products that do not contain a generic dairy word.
DAIRY += [
    "gorgonzola", "gruyere", "camembert", "emmental", "emmentaler", "havarti", "asiago", "pecorino",
    "parmigiano", "manchego", "halloumi", "queso", "cotija", "burrata", "stilton", "roquefort",
    "reblochon", "fontina", "jarlsberg", "colby", "muenster", "neufchatel", "velveeta", "cheez whiz",
    "monterey jack", "pepper jack", "creme fraiche", "crème fraîche", "cool whip", "whipped topping",
    "white chocolate", "milk chocolate", "chocolate chip", "labneh", "skyr", "curd", "lemon curd",
    "creamer",
]
DAIRY_SAFE += ["bean curd"]

EGG = ["egg", "eggs", "egg white", "egg whites", "egg yolk", "egg yolks", "mayonnaise", "meringue",
       "mayo", "aioli", "custard", "hollandaise", "eggnog", "brioche", "challah", "lemon curd"]
# "egg substitute" is deliberately NOT safe: Egg Beaters and most US substitutes are egg whites.
EGG_SAFE = ["egg replacer", "vegan mayonnaise", "vegan mayo", "vegan egg"]

GLUTEN = [
    "flour", "wheat", "bread", "breadcrumbs", "bread crumbs", "panko", "croutons", "pasta",
    "spaghetti", "macaroni", "noodles", "lasagna", "fettuccine", "linguine", "penne", "couscous",
    "bulgur", "barley", "rye", "semolina", "farina", "seitan", "malt", "beer", "soy sauce",
    "tortillas", "pie crust", "biscuit", "biscuits", "crackers", "cake mix", "pizza dough",
    "pita", "bagel", "bagels", "cereal", "graham",
]
# Found by live testing ("momma maglione's easy pasta fagioli" lists "ditalini"
# and was served as gluten-free): pasta shapes, wheat doughs and hidden-wheat
# sauces. Oats count as gluten unless labelled gluten-free — regular oats are
# usually cross-contaminated.
GLUTEN += [
    "ditalini", "orzo", "rigatoni", "ziti", "rotini", "farfalle", "fusilli", "tortellini", "ravioli",
    "gnocchi", "manicotti", "cannelloni", "capellini", "angel hair", "orecchiette", "pappardelle",
    "tagliatelle", "bucatini", "vermicelli", "udon", "ramen", "wonton wrapper", "egg roll wrapper",
    "phyllo", "filo", "puff pastry", "pastry", "dumpling", "matzo", "bisquick", "stuffing", "pretzel",
    "croissant", "english muffin", "bun", "roll", "spelt", "kamut", "farro", "freekeh", "durum",
    "bran", "hoisin", "teriyaki", "oat", "oats", "oatmeal", "granola", "muesli",
]
GLUTEN_SAFE = ["almond flour", "rice flour", "coconut flour", "corn flour", "cornflour",
               "potato flour", "tapioca flour", "chickpea flour", "rice noodles", "rice vermicelli",
               "corn tortillas", "tamari", "spaghetti sauce", "pasta sauce", "rice paper"]
# An ingredient labelled gluten-free is excused as a whole ("gluten-free flour").
GLUTEN_SUBSTITUTE_MARKERS = ["gluten-free", "gluten free"]

NUTS = ["almond", "almonds", "walnut", "walnuts", "pecan", "pecans", "cashew", "cashews",
        "pistachio", "pistachios", "hazelnut", "hazelnuts", "macadamia", "peanut", "peanuts",
        "pine nuts", "brazil nuts", "nut", "nuts", "praline", "marzipan", "nutella"]
NUTS_SAFE = ["nutmeg", "coconut", "butternut", "water chestnut", "water chestnuts"]

HONEY = ["honey"]


def _pattern(words: list[str]) -> re.Pattern:
    alternatives = sorted({re.escape(w) for w in words}, key=len, reverse=True)
    return re.compile(r"\b(?:" + "|".join(alternatives) + r")(?:e?s)?\b")


def _strip(text: str, safe: list[str]) -> str:
    # Longest phrase first, so "celery ribs" is removed whole before "celery rib".
    for phrase in sorted(safe, key=len, reverse=True):
        text = text.replace(phrase, " ")
    return text


@dataclass(frozen=True)
class Rule:
    name: str
    words: re.Pattern
    safe: tuple[str, ...]
    substitute_markers: tuple[str, ...] = ()

    def found(self, ingredient: str) -> bool:
        """True when ONE ingredient contains this rule's food."""
        text = ingredient.lower()
        if any(marker in text for marker in self.substitute_markers):
            return False
        return bool(self.words.search(_strip(text, list(self.safe))))


RULES = {
    "meat": Rule("meat", _pattern(MEAT), tuple(MEAT_SAFE), tuple(MEAT_SUBSTITUTE_MARKERS)),
    "dairy": Rule("dairy", _pattern(DAIRY), tuple(DAIRY_SAFE), tuple(DAIRY_SUBSTITUTE_MARKERS)),
    "egg": Rule("egg", _pattern(EGG), tuple(EGG_SAFE)),
    "gluten": Rule("gluten", _pattern(GLUTEN), tuple(GLUTEN_SAFE), tuple(GLUTEN_SUBSTITUTE_MARKERS)),
    "nuts": Rule("nuts", _pattern(NUTS), tuple(NUTS_SAFE)),
    "honey": Rule("honey", _pattern(HONEY), ()),
}


# Second, independent guard on the recipe NAME. Some Food.com recipes omit the
# main protein from their ingredient list ("tuna noodle casserole" lists no tuna,
# "creamy chicken alfredo" no chicken). A name that mentions meat or fish marks
# the recipe non-vegetarian unless it is clearly a meat-free version or a
# condiment. This also drops a few harmless recipes ("go fish snack") — an
# accepted cost for a vegetarian filter.
NAME_MEAT = re.compile(
    r"\b(?:beef|steak|pork|bacon|ham|chicken|turkey|lamb|veal|sausage|chorizo|pepperoni|salami|"
    r"meatball|meat|fish|salmon|tuna|shrimp|prawn|crab|lobster|clam|oyster|scallop|anchovy|anchovies|"
    r"brisket|rib|burger|venison|duck|goose|bison|jerky|pastrami|prosciutto|tilapia|cod|halibut|trout|"
    r"mahi|bolognese|carbonara|gumbo|jambalaya|liver)(?:e?s)?\b"
)
# Only substitution patterns excuse a meat word — never words that merely
# accompany meat ("gluten free chicken", "soy glazed salmon" stay excluded).
NAME_MEAT_FREE = re.compile(
    r"\b(?:vegan|vegetarian|veggie|tofu|tofurkey|seitan|tempeh|tvp|mock|faux|fake|meatless|"
    r"jackfruit|okara|morningstar|no meat|not chicken|tu no)\b"
    r"|\b(?:meat|fish|anchovy|anchovies|bacon|chicken|tuna|clam)[- ]?(?:free|less)\b"
    r"|\b(?:walnut|lentil|bean|chickpea|nut|pecan|mushroom|portabella|portobello|cauliflower|eggplant|"
    r"zucchini|beet|kumara|potato|carrot|quinoa|rice|oat|cabbage|earth)\s+(?:taco\s+)?"
    r"(?:meat|meatball|burger|steak|bacon|sausage)s?\b"
)


def name_mentions_meat(name: str) -> bool:
    text = str(name or "").lower()
    return bool(NAME_MEAT.search(text)) and not NAME_MEAT_FREE.search(text)


# "Egg Foo Yung", "Parsee Eggs", "Egg Salad"; not "eggplant", "eggless", "egg-free".
NAME_EGG = re.compile(r"\beggs?\b|\bfrittata|\bomelet|\bquiche|\bshakshuka|\bmeringue")
NAME_EGG_FREE = re.compile(r"\begg[\s-]?(?:less|free)\b|\bno[\s-]egg|\bwithout eggs?\b|\bvegan\b")


def name_mentions_egg(name: str) -> bool:
    text = str(name or "").lower()
    return bool(NAME_EGG.search(text)) and not NAME_EGG_FREE.search(text)


def dietary_flags(ingredients: list[str], name: str = "") -> dict[str, bool]:
    """Restriction flags for one recipe (True = allowed).

    Ingredients are checked one by one, so a substitute marker on one ingredient
    ("vegetarian sausages") can never excuse a different one ("bacon"). The
    recipe name is a second guard for meat missing from the ingredient list.
    """
    items = [str(i) for i in ingredients]
    has = {name_: any(rule.found(i) for i in items) for name_, rule in RULES.items()}
    has["meat"] = has["meat"] or name_mentions_meat(name)
    has["egg"] = has["egg"] or name_mentions_egg(name)
    # FitFusion offers both "Vegetarian" and "Eggetarian", so vegetarian means
    # lacto-vegetarian: no meat AND no egg. Eggetarian allows eggs.
    return {
        "is_vegetarian": not (has["meat"] or has["egg"]),
        "is_vegan": not (has["meat"] or has["dairy"] or has["egg"] or has["honey"]),
        "is_eggetarian": not has["meat"],
        "is_dairy_free": not has["dairy"],
        "is_gluten_free": not has["gluten"],
        "is_nut_free": not has["nuts"],
    }


# ── loaders ───────────────────────────────────────────────────────────────────
def _require(name: str):
    path = FOODCOM_DIR / name
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Download {name} from the Food.com Kaggle dataset and "
            "extract it into data/foodcom/."
        )
    return path


def load_recipes() -> pd.DataFrame:
    raw = pd.read_csv(_require("RAW_recipes.csv"))
    nutrition = pd.DataFrame(raw["nutrition"].map(ast.literal_eval).tolist(), columns=NUTRITION_COLUMNS)
    tags = raw["tags"].map(ast.literal_eval)
    ingredients = raw["ingredients"].map(ast.literal_eval)
    flags = pd.DataFrame([dietary_flags(i, n) for i, n in zip(ingredients, raw["name"].fillna(""))])

    recipes = pd.DataFrame(
        {
            "recipe_id": raw["id"].astype(int),
            "name": raw["name"].fillna("").str.strip().str.replace(r"\s+", " ", regex=True),
            "minutes": raw["minutes"].astype(int),
            "n_ingredients": raw["n_ingredients"].astype(int),
            "kcal": nutrition["kcal"].astype(float),
            "protein_g": (nutrition["protein_pdv"] * PROTEIN_DV_GRAMS / 100.0).round(1),
            "fat_pdv": nutrition["fat_pdv"],
            "sugar_pdv": nutrition["sugar_pdv"],
            "sodium_pdv": nutrition["sodium_pdv"],
            "satfat_pdv": nutrition["satfat_pdv"],
            "carbs_pdv": nutrition["carbs_pdv"],
            "tags": tags,
            "ingredients": ingredients,
            "tagged_vegetarian": tags.map(lambda t: "vegetarian" in t),
        }
    )
    for course in COURSE_TAGS:
        recipes[f"course_{course.replace('-', '_')}"] = tags.map(lambda t, c=course: c in t)
    recipes = pd.concat([recipes, flags], axis=1)
    recipes["recommendable"] = recipes["kcal"].between(KCAL_MIN, KCAL_MAX) & (recipes["name"] != "")
    return recipes


def load_likes() -> tuple[pd.DataFrame, dict]:
    raw = pd.read_csv(_require("RAW_interactions.csv"), usecols=["user_id", "recipe_id", "date", "rating"])
    stats = {
        "raw_interactions": int(len(raw)),
        "unrated_reviews_dropped": int((raw["rating"] == 0).sum()),
        "rated_below_threshold": int(raw["rating"].between(1, LIKE_THRESHOLD - 1).sum()),
    }
    likes = raw[raw["rating"] >= LIKE_THRESHOLD].copy()
    likes["date"] = pd.to_datetime(likes["date"])
    likes = likes[["user_id", "recipe_id", "date"]].sort_values(["date", "user_id"]).reset_index(drop=True)
    stats["likes"] = int(len(likes))
    return likes, stats


@dataclass
class Split:
    name: str
    train: pd.DataFrame
    evaluation: pd.DataFrame
    cutoff: pd.Timestamp
    end: pd.Timestamp | None


def make_split(likes: pd.DataFrame, recipes: pd.DataFrame, cutoff: str, end: str | None, name: str) -> Split:
    cut = pd.Timestamp(cutoff)
    stop = pd.Timestamp(end) if end else None
    train = likes[likes["date"] < cut]
    evaluation = likes[likes["date"] >= cut]
    if stop is not None:
        evaluation = evaluation[evaluation["date"] < stop]
    evaluation = evaluation[evaluation["user_id"].isin(set(train["user_id"]))]
    recommendable = set(recipes.loc[recipes["recommendable"], "recipe_id"])
    evaluation = evaluation[evaluation["recipe_id"].isin(recommendable)]
    return Split(name, train.reset_index(drop=True), evaluation.reset_index(drop=True), cut, stop)


def validation_split(likes, recipes) -> Split:
    return make_split(likes, recipes, VALIDATION_CUTOFFS[0], VALIDATION_CUTOFFS[1], "validation")


def test_split(likes, recipes) -> Split:
    return make_split(likes, recipes, TEST_CUTOFF, None, "test")


def history_bucket(n: int) -> str:
    if n <= 1:
        return "1"
    if n <= 4:
        return "2-4"
    if n <= 19:
        return "5-19"
    return "20+"


def describe_split(split: Split) -> dict:
    history = split.train.groupby("user_id").size()
    users = split.evaluation["user_id"].unique()
    buckets = pd.Series([history_bucket(int(history[u])) for u in users]).value_counts()
    warm = split.evaluation["recipe_id"].isin(set(split.train["recipe_id"]))
    return {
        "train_likes": int(len(split.train)),
        "train_users": int(split.train["user_id"].nunique()),
        "train_recipes": int(split.train["recipe_id"].nunique()),
        "eval_users": int(len(users)),
        "eval_likes": int(len(split.evaluation)),
        "eval_recipes_seen_in_train": float(warm.mean()) if len(warm) else 0.0,
        "eval_users_by_history": {b: int(buckets.get(b, 0)) for b in ["1", "2-4", "5-19", "20+"]},
    }


def main() -> None:
    banner("Model 2 data — Food.com recipes and ratings")

    recipes = load_recipes()
    likes, like_stats = load_likes()

    print("\n  Recipes")
    print(f"    total                          {len(recipes):8d}")
    bad_kcal = int((~recipes['kcal'].between(KCAL_MIN, KCAL_MAX)).sum())
    print(f"    kcal outside {KCAL_MIN:g}-{KCAL_MAX:g}/serving      {bad_kcal:8d}  (kept for taste, never recommended)")
    print(f"    recommendable                  {int(recipes['recommendable'].sum()):8d}")

    print("\n  Dietary flags from ingredients (share of recommendable recipes)")
    rec = recipes[recipes["recommendable"]]
    for flag in ["is_vegetarian", "is_vegan", "is_dairy_free", "is_gluten_free", "is_nut_free"]:
        print(f"    {flag:18s} {rec[flag].mean() * 100:5.1f}%  ({int(rec[flag].sum())})")

    tagged = recipes[recipes["tagged_vegetarian"]]
    rejected = tagged[~tagged["is_vegetarian"]]
    print(f"\n  Tag check: {len(rejected)} of {len(tagged)} recipes tagged 'vegetarian' contain meat, fish or egg "
          "ingredients and are NOT treated as vegetarian. Examples:")
    for _, row in rejected.sample(min(5, len(rejected)), random_state=RANDOM_SEED).iterrows():
        meaty = [i for i in row["ingredients"] if RULES["meat"].found(str(i).lower())]
        print(f"    - {row['name'][:45]:45s} → {', '.join(meaty[:3])}")

    # Manual audit. Audit 1 found the plural bug, so it cannot also measure the
    # fixed filter; audit 2 is a fresh random sample that excludes its recipes.
    print(f"\n  Manual audit 1 (before plural fix): {AUDIT_1_TRUE_VEGETARIAN}/{len(AUDIT_1_IDS)} truly "
          f"vegetarian; the 3 misses led to the plural rule")
    still_flagged = rec[rec["recipe_id"].isin(AUDIT_1_MISSES) & rec["is_vegetarian"]]
    print(f"  Audit 1 misses still flagged vegetarian after the fix: {len(still_flagged)}")
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    if AUDIT_2_PATH.exists():
        print(f"  Audit 2 sheet already exists, not overwritten: {AUDIT_2_PATH}")
    else:
        pool = rec[rec["is_vegetarian"] & ~rec["recipe_id"].isin(AUDIT_1_IDS)]
        audit = pool.sample(AUDIT_SIZE, random_state=RANDOM_SEED + 1)
        pd.DataFrame(
            {
                "recipe_id": audit["recipe_id"],
                "name": audit["name"],
                "ingredients": audit["ingredients"].map(lambda i: "; ".join(i)),
                "actually_vegetarian (fill Y/N)": "",
            }
        ).to_csv(AUDIT_2_PATH, index=False)
        print(f"[data] wrote {AUDIT_2_PATH}  ← {AUDIT_SIZE} NEW recipes for manual vegetarian check")

    print("\n  Ratings")
    print(f"    raw interactions               {like_stats['raw_interactions']:8d}")
    print(f"    unrated reviews (0) dropped    {like_stats['unrated_reviews_dropped']:8d}")
    print(f"    rated 1-3 (not a like)         {like_stats['rated_below_threshold']:8d}")
    print(f"    likes (4-5 stars)              {like_stats['likes']:8d}  "
          f"from {likes['user_id'].nunique()} users on {likes['recipe_id'].nunique()} recipes")

    print("\n  Splits (global date cutoffs — no future information in training)")
    for split in (validation_split(likes, recipes), test_split(likes, recipes)):
        d = describe_split(split)
        window = f"{split.cutoff.date()} → {split.end.date() if split.end is not None else 'end'}"
        print(f"    {split.name:10s} evaluate {window}")
        print(f"      train: {d['train_likes']} likes, {d['train_users']} users, {d['train_recipes']} recipes")
        print(f"      evaluate: {d['eval_users']} users, {d['eval_likes']} likes, "
              f"{d['eval_recipes_seen_in_train']:.1%} of liked recipes seen in training")
        print(f"      evaluation users by prior likes (1 / 2-4 / 5-19 / 20+): "
              f"{' / '.join(str(v) for v in d['eval_users_by_history'].values())}")

    recipes.to_pickle(RECIPES_PATH)
    likes.to_pickle(LIKES_PATH)
    print(f"\n[data] wrote {RECIPES_PATH}")
    print(f"[data] wrote {LIKES_PATH}")


if __name__ == "__main__":
    main()
