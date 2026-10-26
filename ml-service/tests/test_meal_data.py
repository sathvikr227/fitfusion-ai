"""Model 2 data — dietary flags and split integrity."""

from __future__ import annotations

import pandas as pd
import pytest

from training import data_foodcom as fc


@pytest.mark.parametrize(
    "ingredients, flag, allowed",
    [
        (["celery ribs", "carrots"], "is_vegetarian", True),
        (["goat cheese", "arugula"], "is_vegetarian", True),
        (["vegetarian ground beef", "onion"], "is_vegetarian", True),
        (["vegetarian sausages", "bacon"], "is_vegetarian", False),
        (["imitation crab meat"], "is_vegetarian", False),
        (["chicken broth", "rice"], "is_vegetarian", False),
        (["vegetable broth", "rice"], "is_vegetarian", True),
        (["anchovy paste"], "is_vegetarian", False),
        # From the manual audit: plurals and "rib" slipped through.
        (["new york strip steaks", "soy sauce"], "is_vegetarian", False),
        (["flank steaks", "lime juice"], "is_vegetarian", False),
        (["prime rib roast", "garlic"], "is_vegetarian", False),
        (["celery ribs", "celery rib"], "is_vegetarian", True),
        (["hamburger buns", "lettuce"], "is_vegetarian", True),
        (["cornish game hens"], "is_vegetarian", False),
        (["oyster crackers", "oyster mushrooms", "hamburger bun"], "is_vegetarian", True),
        (["clam juice"], "is_vegetarian", False),
        # Found by live testing of /recommend.
        (["rump roast", "onion"], "is_vegetarian", False),
        (["pot roast"], "is_vegetarian", False),
        (["spam"], "is_vegetarian", False),
        (["orange roughy fillets"], "is_vegetarian", False),
        (["dashi"], "is_vegetarian", False),
        (["worcestershire sauce"], "is_vegetarian", False),
        (["vegetarian worcestershire sauce", "dark roast coffee", "vegetable marrow"], "is_vegetarian", True),
        (["roasted red peppers", "peppermint patties"], "is_vegetarian", True),
        (["refrigerated pie crusts"], "is_gluten_free", False),
        (["vegetable suet", "flour"], "is_vegetarian", True),
        (["peanut butter", "banana"], "is_dairy_free", True),
        (["coconut milk"], "is_dairy_free", True),
        (["parmesan cheese"], "is_dairy_free", False),
        (["vegan cheese", "dairy-free margarine"], "is_dairy_free", True),
        # Non-dairy creamer and whipped topping usually contain casein.
        (["non-dairy creamer"], "is_dairy_free", False),
        (["non-dairy whipped topping"], "is_vegan", False),
        # Found by live testing: named cheeses and dairy products.
        (["pears", "gorgonzola", "walnut halves"], "is_vegan", False),
        (["queso fresco"], "is_dairy_free", False),
        (["cool whip"], "is_dairy_free", False),
        (["semi-sweet chocolate chips"], "is_vegan", False),
        (["semisweet vegan chocolate chips"], "is_vegan", True),
        (["firm bean curd"], "is_dairy_free", True),
        (["lemon curd"], "is_vegan", False),
        (["aioli"], "is_vegan", False),
        (["eggplant", "tomato"], "is_vegan", True),
        (["egg beaters egg substitute"], "is_vegan", False),
        (["honey", "oats"], "is_vegan", False),
        (["nutmeg", "coconut", "butternut squash"], "is_nut_free", True),
        (["pine nuts"], "is_nut_free", False),
        (["almond flour", "rice noodles", "spaghetti sauce"], "is_gluten_free", True),
        (["soy sauce"], "is_gluten_free", False),
        (["all-purpose flour"], "is_gluten_free", False),
        # Found by live testing: pasta shapes and wheat products without "pasta".
        (["cannellini beans", "ditalini"], "is_gluten_free", False),
        (["orzo"], "is_gluten_free", False),
        (["gnocchi"], "is_gluten_free", False),
        (["phyllo dough"], "is_gluten_free", False),
        (["hoisin sauce"], "is_gluten_free", False),
        # Ordinary oats are cross-contaminated; labelled ones are allowed.
        (["rolled oats", "raisins"], "is_gluten_free", False),
        (["gluten-free rolled oats"], "is_gluten_free", True),
        (["gluten free all-purpose flour"], "is_gluten_free", True),
        (["rice paper", "rice vermicelli"], "is_gluten_free", True),
    ],
)
def test_dietary_flags(ingredients, flag, allowed):
    assert fc.dietary_flags(ingredients)[flag] is allowed


@pytest.mark.parametrize(
    "name, ingredients, vegetarian",
    [
        # Food.com sometimes leaves the main protein out of the ingredient list.
        ("quick and easy tuna noodle casserole", ["noodles", "cream of mushroom soup"], False),
        ("creamy chicken alfredo", ["heavy cream", "parmesan cheese"], False),
        ("gluten free fried chicken", ["rice flour", "salt"], False),
        ("soy glazed salmon", ["soy sauce", "honey"], False),
        # Substitutions stay vegetarian.
        ("chickpea burger", ["chickpeas", "egg", "flour"], True),
        ("walnut taco meat", ["walnuts", "cumin"], True),
        ("vegan bacon", ["firm tofu", "liquid smoke"], True),
        ("anchovy free black olive tapenade", ["olives", "capers"], True),
        ("the best belgian waffles", ["flour", "eggs", "milk"], True),
        # New ingredient words from the name audit.
        ("honey baked", ["fryer", "honey"], False),
        ("hawaiian", ["spareribs", "pineapple"], False),
        ("salad", ["surimi", "avocado"], False),
    ],
)
def test_recipe_name_is_a_second_vegetarian_guard(name, ingredients, vegetarian):
    assert fc.dietary_flags(ingredients, name)["is_vegetarian"] is vegetarian


needs_foodcom = pytest.mark.skipif(
    not (fc.FOODCOM_DIR / "RAW_interactions.csv").exists(), reason="Food.com not downloaded"
)


@needs_foodcom
def test_splits_never_train_on_the_future():
    likes = pd.read_pickle(fc.LIKES_PATH) if fc.LIKES_PATH.exists() else fc.load_likes()[0]
    recipes = pd.read_pickle(fc.RECIPES_PATH) if fc.RECIPES_PATH.exists() else fc.load_recipes()
    for split in (fc.validation_split(likes, recipes), fc.test_split(likes, recipes)):
        assert split.train["date"].max() < split.cutoff <= split.evaluation["date"].min()
        if split.end is not None:
            assert split.evaluation["date"].max() < split.end
        assert split.evaluation["user_id"].isin(set(split.train["user_id"])).all()
        recommendable = set(recipes.loc[recipes["recommendable"], "recipe_id"])
        assert split.evaluation["recipe_id"].isin(recommendable).all()
