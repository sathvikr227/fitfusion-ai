import { NextResponse } from "next/server";

type ExerciseDbItem = {
  id?: string | number;
  name?: string;
  gifUrl?: string;
  gif?: string;
  image?: string;
  url?: string;
  target?: string;
  targetMuscles?: string[] | string;
  bodyPart?: string;
  bodyParts?: string[] | string;
  equipment?: string;
  equipments?: string[] | string;
  instructions?: string[];
};

type WorkoutExerciseCard = {
  title: string;
  gifUrl: string | null;
  target: string[];
  equipment: string[];
  bodyPart: string;
  videoUrl: string;
};

type WorkoutSingleResponse = {
  found: boolean;
  category: "workout";
  type: "single";
  query: string;
  title: string;
  muscles: string[];
  steps: string[];
  tips: string[];
  videoUrl: string;
  gifUrl: string | null;
  source: "api";
};

type WorkoutListResponse = {
  found: boolean;
  category: "workout";
  type: "list";
  query: string;
  title: string;
  exercises: WorkoutExerciseCard[];
  steps: string[];
  tips: string[];
  videoUrl: string;
  gifUrl: null;
  source: "api";
};

type WorkoutResponse = WorkoutSingleResponse | WorkoutListResponse;

let exerciseCache: ExerciseDbItem[] | null = null;
let exerciseCachePromise: Promise<ExerciseDbItem[]> | null = null;

function normalize(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ");
}

function titleCase(text: string) {
  return text
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "number") {
    return [String(value)];
  }

  return [];
}

function normalizeMediaUrl(value?: string | null) {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  return `https://v2.exercisedb.io/image/${trimmed.replace(/^\/+/, "")}`;
}

function getHeaders(apiKey: string) {
  return {
    "X-RapidAPI-Key": apiKey,
    "X-RapidAPI-Host": "exercisedb.p.rapidapi.com",
  };
}

function buildAllExercisesUrl() {
  return `https://exercisedb.p.rapidapi.com/exercises`;
}

function buildApiUrl(query: string) {
  return `https://exercisedb.p.rapidapi.com/exercises/name/${encodeURIComponent(
    query
  )}`;
}

function getQueryVariants(query: string) {
  const n = normalize(query);

  const variants = new Set<string>([
    query.trim(),
    n,
    n.replace(/\s+/g, "-"),
    n.replace(/-/g, " "),
    n.replace(/\s+/g, ""),
    n.endsWith("s") ? n.slice(0, -1) : n,
  ]);

  const smartMap: Record<string, string[]> = {
    "cable fly": ["cable chest fly", "cable crossover"],
    "cable flys": ["cable fly", "cable chest fly", "cable crossover"],
    fly: ["chest fly", "dumbbell fly", "cable fly"],
    pushup: ["push-up", "push up"],
    pullup: ["pull-up", "pull up"],
    squat: ["barbell squat", "bodyweight squat"],
    deadlift: ["barbell deadlift"],
  };

  if (smartMap[n]) {
    smartMap[n].forEach((item) => variants.add(item));
  }

  return Array.from(variants).filter(Boolean);
}

function scoreExerciseItem(item: ExerciseDbItem, query: string, variants: string[]) {
  const itemName = normalize(item.name ?? "");
  const q = normalize(query);

  let score = 0;

  if (itemName === q) score += 100;
  if (variants.some((variant) => normalize(variant) === itemName)) score += 80;
  if (variants.some((variant) => itemName.includes(normalize(variant)))) score += 50;
  if (itemName.includes(q)) score += 30;
  if (q.includes(itemName)) score += 20;

  return score;
}

function pickBestExercise(items: ExerciseDbItem[], query: string) {
  const variants = getQueryVariants(query);

  return items
    .filter((item) => Boolean(item?.name))
    .sort(
      (a, b) =>
        scoreExerciseItem(b, query, variants) - scoreExerciseItem(a, query, variants)
    )[0];
}

function mapExerciseDbItem(item: ExerciseDbItem, query: string): WorkoutSingleResponse {
  const name = item.name?.trim() || query;
  const title = titleCase(name);

  const muscles = [
    ...toStringArray(item.targetMuscles),
    ...toStringArray(item.target),
    ...toStringArray(item.bodyPart),
  ].filter(Boolean);

  const uniqueMuscles = Array.from(new Set(muscles));
  const bodyParts = toStringArray(item.bodyParts);
  const equipments = toStringArray(item.equipments);

  const rawMedia = item.gifUrl || item.gif || item.image || item.url || null;

  return {
    found: true,
    category: "workout",
    type: "single",
    query,
    title,
    muscles: uniqueMuscles.length > 0 ? uniqueMuscles : bodyParts,
    steps: item.instructions?.length
      ? item.instructions
      : [
          "Watch the exercise demonstration carefully.",
          "Follow proper form and keep movements controlled.",
          "Start with a light weight before progressing.",
        ],
    tips: [
      bodyParts.length > 0 ? `Primary body parts: ${bodyParts.join(", ")}` : null,
      equipments.length > 0 ? `Equipment: ${equipments.join(", ")}` : null,
      "Keep posture stable and avoid using momentum.",
    ].filter(Boolean) as string[],
    videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(
      `${name} proper form`
    )}`,
    gifUrl: normalizeMediaUrl(rawMedia),
    source: "api",
  };
}

type BodyPartConfig = {
  bodyParts: string[];
  boostTerms: string[];
  mustIncludeTerms?: string[];
};

function getBodyPartConfig(query: string): BodyPartConfig | null {
  const n = normalize(query);
  const compact = n.replace(/\s+/g, "");

  if (["chest", "pecs", "pec", "chests"].includes(n) || compact === "chest") {
    if (n.includes("upper chest")) {
      return {
        bodyParts: ["chest"],
        boostTerms: [
          "upper chest",
          "incline",
          "incline press",
          "incline dumbbell",
          "incline fly",
          "low to high",
          "cable fly",
          "chest",
          "pec",
          "pectorals",
        ],
      };
    }

    if (n.includes("lower chest")) {
      return {
        bodyParts: ["chest"],
        boostTerms: [
          "lower chest",
          "decline",
          "dip",
          "high to low",
          "decline press",
          "decline dumbbell",
          "chest",
          "pec",
          "pectorals",
        ],
      };
    }

    return {
      bodyParts: ["chest"],
      boostTerms: [
        "chest",
        "pec",
        "pectoral",
        "pectorals",
        "bench",
        "press",
        "fly",
        "crossover",
        "push up",
        "push-up",
        "dip",
      ],
    };
  }

  if (["core", "abs", "ab", "waist"].includes(n) || ["core", "abs", "waist"].includes(compact)) {
    return {
      bodyParts: ["waist"],
      boostTerms: ["core", "abs", "waist"],
    };
  }

  if (["back"].includes(n)) {
    return {
      bodyParts: ["back"],
      boostTerms: ["back", "lat", "rear delt"],
    };
  }

  if (["shoulder", "shoulders"].includes(n)) {
    return {
      bodyParts: ["shoulders"],
      boostTerms: ["shoulder", "deltoid"],
    };
  }

  if (["arm", "arms", "biceps", "bicep", "triceps", "tricep", "upper arms"].includes(n)) {
    return {
      bodyParts: ["upper arms"],
      boostTerms: ["bicep", "tricep", "arm", "upper arms"],
    };
  }

  if (["leg", "legs", "lower body"].includes(n)) {
    return {
      bodyParts: ["upper legs", "lower legs"],
      boostTerms: ["leg", "quad", "hamstring", "glute", "calf"],
    };
  }

  if (["quads", "quad", "quadriceps"].includes(n)) {
    return {
      bodyParts: ["upper legs"],
      boostTerms: ["quad", "squat", "leg extension"],
    };
  }

  if (["hamstrings"].includes(n)) {
    return {
      bodyParts: ["upper legs"],
      boostTerms: ["hamstring", "leg curl", "deadlift"],
    };
  }

  if (["glutes", "glute"].includes(n)) {
    return {
      bodyParts: ["upper legs"],
      boostTerms: ["glute", "hip thrust", "squat"],
    };
  }

  if (["calves", "calf"].includes(n)) {
    return {
      bodyParts: ["lower legs"],
      boostTerms: ["calf", "raise"],
    };
  }

  return null;
}

function getExerciseSearchText(item: ExerciseDbItem) {
  return normalize(
    [
      ...toStringArray(item.name),
      ...toStringArray(item.target),
      ...toStringArray(item.targetMuscles),
      ...toStringArray(item.bodyPart),
      ...toStringArray(item.bodyParts),
      ...toStringArray(item.equipment),
      ...toStringArray(item.equipments),
    ].join(" ")
  );
}

function scoreByBodyPartQuery(item: ExerciseDbItem, query: string, config: BodyPartConfig) {
  const title = normalize(item.name ?? "");
  const target = getExerciseSearchText(item);
  const haystack = `${title} ${target}`;
  let score = 0;

  if (config.mustIncludeTerms?.length) {
    const ok = config.mustIncludeTerms.every((term) => haystack.includes(normalize(term)));
    if (!ok) return -9999;
  }

  for (const term of config.boostTerms) {
    const t = normalize(term);
    if (title.includes(t)) score += 30;
    if (target.includes(t)) score += 20;
    if (haystack.includes(t)) score += 10;
  }

  const q = normalize(query);
  if (title.includes(q)) score += 15;

  return score;
}

function dedupeExercises(items: ExerciseDbItem[]) {
  const seen = new Set<string>();
  const result: ExerciseDbItem[] = [];

  for (const item of items) {
    const key = normalize(item.name || String(item.id || ""));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

function mapWorkoutCard(item: ExerciseDbItem, query: string): WorkoutExerciseCard {
  const name = item.name?.trim() || query;
  const title = titleCase(name);
  const target = toStringArray(item.targetMuscles).concat(toStringArray(item.target));
  const equipment = toStringArray(item.equipment).concat(toStringArray(item.equipments));
  const bodyPart = item.bodyPart?.trim() || query;
  const rawMedia = item.gifUrl || item.gif || item.image || item.url || null;

  return {
    title,
    gifUrl: normalizeMediaUrl(rawMedia),
    target: Array.from(new Set(target)),
    equipment: Array.from(new Set(equipment)),
    bodyPart,
    videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(
      `${name} proper form`
    )}`,
  };
}

function isBodyPartMatch(item: ExerciseDbItem, config: BodyPartConfig) {
  const haystack = getExerciseSearchText(item);

  const primaryMatch = config.bodyParts.some((part) => haystack.includes(normalize(part)));
  const boostMatch = config.boostTerms.some((term) => haystack.includes(normalize(term)));

  return primaryMatch || boostMatch;
}

async function fetchAllExercises(): Promise<ExerciseDbItem[] | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  if (exerciseCache) return exerciseCache;
  if (exerciseCachePromise) return exerciseCachePromise;

  exerciseCachePromise = fetch(buildAllExercisesUrl(), {
    headers: getHeaders(apiKey),
    cache: "no-store",
  })
    .then(async (res) => {
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? (data as ExerciseDbItem[]) : [];
    })
    .catch((error) => {
      console.error("ExerciseDB full dataset fetch error:", error);
      return [];
    })
    .then((items) => {
      exerciseCache = items;
      exerciseCachePromise = null;
      return items;
    });

  return exerciseCachePromise;
}

async function fetchFromExerciseDb(query: string): Promise<WorkoutSingleResponse | null> {
  const allExercises = await fetchAllExercises();
  if (!allExercises || allExercises.length === 0) return null;

  const variants = getQueryVariants(query);
  const normalizedQuery = normalize(query);

  const scored = allExercises
    .map((item) => ({
      item,
      score: scoreExerciseItem(item, query, variants),
      name: normalize(item.name ?? ""),
      target: normalize(
        [
          ...toStringArray(item.targetMuscles),
          ...toStringArray(item.target),
          ...toStringArray(item.bodyPart),
          ...toStringArray(item.bodyParts),
          ...toStringArray(item.equipment),
          ...toStringArray(item.equipments),
        ].join(" ")
      ),
    }))
    .filter(({ item }) => Boolean(item?.name))
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.item;

  if (!best) return null;

  const bestName = normalize(best.name ?? "");

  const exactMatch = scored.find(
    ({ name, target }) =>
      name === normalizedQuery || name === bestName || target.includes(normalizedQuery)
  );

  return mapExerciseDbItem((exactMatch?.item ?? best) as ExerciseDbItem, query);
}

async function fetchByBodyPart(query: string): Promise<WorkoutListResponse | null> {
  const allExercises = await fetchAllExercises();
  if (!allExercises || allExercises.length === 0) return null;

  const config = getBodyPartConfig(query);
  if (!config) return null;

  const matched = allExercises
    .filter((item) => isBodyPartMatch(item, config))
    .map((item) => ({
      item,
      score: scoreByBodyPartQuery(item, query, config),
    }))
    .filter(({ score }) => score > -9999)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);

  const uniqueItems = dedupeExercises(matched);
  if (uniqueItems.length === 0) return null;

  const exercises = uniqueItems.map((item) => mapWorkoutCard(item, query));

  return {
    found: true,
    category: "workout",
    type: "list",
    query,
    title: `${titleCase(query)} Exercises`,
    exercises,
    steps: [],
    tips: [
      `Showing every matching exercise for ${query}.`,
      "Tap any workout card to open that exact exercise.",
      "Use controlled movement and start light.",
    ],
    videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(
      `${query} exercises`
    )}`,
    gifUrl: null,
    source: "api",
  };
}

async function handleQuery(query: string) {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const bodyPartResult = await fetchByBodyPart(normalizedQuery);
    if (bodyPartResult) {
      return NextResponse.json(bodyPartResult);
    }

    const apiResult = await fetchFromExerciseDb(normalizedQuery);
    if (apiResult) {
      return NextResponse.json(apiResult);
    }
  } catch (error) {
    console.error("ExerciseDB fetch error:", error);
  }

  return NextResponse.json({
    found: false,
    category: "workout",
    type: "single",
    query: normalizedQuery,
    title: titleCase(normalizedQuery),
    muscles: [],
    steps: [],
    tips: [
      "No workout found from the API for this query.",
      "Try a different exercise name or a body part like chest, core, back, or legs.",
    ],
    videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(
      normalizedQuery + " proper form"
    )}`,
    gifUrl: null,
    source: "api" as const,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = String(body?.query || body?.name || "").trim();
    return handleQuery(query);
  } catch (error) {
    console.error("Workout help error:", error);
    return NextResponse.json(
      { error: "Failed to process workout request" },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const query = String(
      searchParams.get("query") || searchParams.get("name") || ""
    ).trim();
    return handleQuery(query);
  } catch (error) {
    console.error("Workout help error:", error);
    return NextResponse.json(
      { error: "Failed to process workout request" },
      { status: 500 }
    );
  }
}