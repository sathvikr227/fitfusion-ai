import { NextResponse } from "next/server";

type Recipe = {
  title: string;
  ingredients: string[];
  steps: string[];
  tips?: string[];
  videoUrl: string;
};

const RECIPES: Record<string, Recipe> = {
  "lemon rice": {
    title: "Lemon Rice",
    ingredients: [
      "2 cups cooked rice",
      "2 tablespoons oil",
      "1 teaspoon mustard seeds",
      "1 tablespoon peanuts",
      "1 green chili, chopped",
      "8 to 10 curry leaves",
      "1/2 teaspoon turmeric",
      "Salt to taste",
      "2 to 3 tablespoons lemon juice",
    ],
    steps: [
      "Heat oil in a pan.",
      "Add mustard seeds and let them splutter.",
      "Add peanuts and fry until slightly golden.",
      "Add green chili and curry leaves.",
      "Add turmeric and salt, then mix well.",
      "Add cooked rice and gently combine.",
      "Turn off the flame and add lemon juice.",
      "Mix lightly and serve warm.",
    ],
    tips: [
      "Use cooled rice for best texture.",
      "Add lemon juice at the end to keep the flavor fresh.",
    ],
    videoUrl: "https://www.youtube.com/results?search_query=lemon+rice+recipe",
  },
  "poha": {
    title: "Poha",
    ingredients: [
      "2 cups poha",
      "1 onion, chopped",
      "1 green chili",
      "1/2 teaspoon mustard seeds",
      "Curry leaves",
      "1/4 teaspoon turmeric",
      "Salt to taste",
      "Lemon juice",
      "Coriander leaves",
    ],
    steps: [
      "Wash poha gently and drain.",
      "Heat oil in a pan and add mustard seeds.",
      "Add curry leaves, onion, and green chili.",
      "Add turmeric and salt.",
      "Add poha and mix gently.",
      "Cook for 2 to 3 minutes.",
      "Add lemon juice and coriander before serving.",
    ],
    tips: ["Do not over-wash poha or it will become mushy."],
    videoUrl: "https://www.youtube.com/results?search_query=poha+recipe",
  },
  "oats": {
    title: "Vegetable Oats",
    ingredients: [
      "1 cup oats",
      "1/2 onion, chopped",
      "1/2 carrot, chopped",
      "1/2 capsicum, chopped",
      "1 teaspoon oil",
      "Salt and pepper",
      "Water",
    ],
    steps: [
      "Heat oil in a pan.",
      "Add onion and vegetables.",
      "Cook for 2 to 3 minutes.",
      "Add oats and water.",
      "Cook until oats become soft and thick.",
      "Season with salt and pepper.",
      "Serve hot.",
    ],
    tips: ["Add a little milk for a creamier version."],
    videoUrl: "https://www.youtube.com/results?search_query=vegetable+oats+recipe",
  },
  "paneer bhurji": {
    title: "Paneer Bhurji",
    ingredients: [
      "200g paneer",
      "1 onion",
      "1 tomato",
      "1 green chili",
      "1 teaspoon oil",
      "Turmeric",
      "Red chili powder",
      "Salt",
      "Coriander leaves",
    ],
    steps: [
      "Heat oil in a pan.",
      "Add onion and green chili, cook until soft.",
      "Add tomato and spices.",
      "Cook until the tomato softens.",
      "Add crumbled paneer.",
      "Mix well and cook for 2 to 3 minutes.",
      "Garnish with coriander leaves.",
    ],
    tips: ["Serve with roti or bread for a quick meal."],
    videoUrl: "https://www.youtube.com/results?search_query=paneer+bhurji+recipe",
  },
  "egg omelette": {
    title: "Egg Omelette",
    ingredients: [
      "2 eggs",
      "1 onion, chopped",
      "1 green chili",
      "Salt",
      "Pepper",
      "Oil or butter",
      "Coriander leaves",
    ],
    steps: [
      "Beat the eggs in a bowl.",
      "Add onion, chili, salt, pepper, and coriander.",
      "Heat a pan with oil or butter.",
      "Pour the egg mixture into the pan.",
      "Cook both sides until set.",
      "Serve hot.",
    ],
    tips: ["Add cheese or vegetables for extra protein and taste."],
    videoUrl: "https://www.youtube.com/results?search_query=egg+omelette+recipe",
  },
  "banana smoothie": {
    title: "Banana Smoothie",
    ingredients: [
      "2 bananas",
      "1 cup milk",
      "1 tablespoon honey",
      "A few ice cubes",
    ],
    steps: [
      "Add banana, milk, and honey to a blender.",
      "Blend until smooth.",
      "Add ice cubes if needed.",
      "Pour into a glass and serve chilled.",
    ],
    tips: ["Add peanut butter or oats for a more filling smoothie."],
    videoUrl: "https://www.youtube.com/results?search_query=banana+smoothie+recipe",
  },
};

function normalize(text: string) {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

function findRecipe(query: string): Recipe | null {
  const q = normalize(query);

  if (RECIPES[q]) return RECIPES[q];

  const exactContains = Object.entries(RECIPES).find(([key]) => q.includes(key));
  if (exactContains) return exactContains[1];

  const partialMatch = Object.entries(RECIPES).find(([key]) => key.includes(q));
  if (partialMatch) return partialMatch[1];

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const query = String(body?.query || "").trim();

    if (!query) {
      return NextResponse.json(
        { error: "Query is required" },
        { status: 400 }
      );
    }

    const recipe = findRecipe(query);

    if (recipe) {
      return NextResponse.json({
        found: true,
        category: "diet",
        query,
        ...recipe,
      });
    }

    return NextResponse.json({
      found: false,
      category: "diet",
      query,
      title: query,
      ingredients: [],
      steps: [
        "No exact recipe found in the local dataset.",
        "Try a more specific food name like 'lemon rice' or 'paneer bhurji'.",
      ],
      tips: [
        "You can still watch a YouTube recipe using the link below.",
      ],
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(
        query + " recipe"
      )}`,
    });
  } catch (error) {
    console.error("Recipe help error:", error);
    return NextResponse.json(
      { error: "Failed to process recipe request" },
      { status: 500 }
    );
  }
}