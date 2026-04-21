"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Search,
  UtensilsCrossed,
  Dumbbell,
  Youtube,
  Sparkles,
  ChevronRight,
  ArrowLeft,
  ChefHat,
  Target,
} from "lucide-react";

type HelpMode = "diet" | "workout";

type WorkoutExerciseCard = {
  title: string;
  gifUrl?: string | null;
  target?: string[];
  equipment?: string[];
  bodyPart?: string;
  videoUrl?: string;
};

type HelpResult = {
  found: boolean;
  category: HelpMode;
  query: string;
  title: string;
  ingredients?: string[];
  muscles?: string[];
  steps: string[];
  tips?: string[];
  videoUrl: string;
  gifUrl?: string | null;
  source?: "local" | "api";
  type?: "single" | "list";
  exercises?: WorkoutExerciseCard[];
};

type ApiResponse = Partial<HelpResult> & {
  results?: HelpResult[];
  error?: string;
  message?: string;
};

function ExerciseGif({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-700">
      {!loaded && !failed && (
        <div className="absolute inset-0 animate-pulse bg-slate-200 dark:bg-slate-600" />
      )}
      {failed ? (
        <div className="flex h-full w-full items-center justify-center text-slate-400 dark:text-slate-500">
          <Dumbbell className="h-10 w-10" />
        </div>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`h-full w-full object-contain p-2 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      )}
    </div>
  );
}

export default function HelpPage() {
  const [mode, setMode] = useState<HelpMode>("diet");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HelpResult | null>(null);
  const [error, setError] = useState("");

  const buildYoutubeUrl = (searchText: string) => {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent(searchText)}`;
  };

  const pickPrimaryResponse = (data: ApiResponse): Partial<HelpResult> => {
    if (Array.isArray(data.results) && data.results.length > 0) {
      return data.results[0];
    }
    return data;
  };

  const normalizeResponse = (
    rawData: ApiResponse,
    finalQuery: string,
    currentMode: HelpMode
  ): HelpResult => {
    const data = pickPrimaryResponse(rawData);

    if (currentMode === "workout" && data.type === "list" && Array.isArray(data.exercises)) {
      return {
        found: data.found ?? true,
        category: "workout",
        type: "list",
        query: data.query ?? finalQuery,
        title:
          data.title?.trim() ||
          finalQuery
            .trim()
            .replace(/\s+/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase()),
        steps: [],
        tips:
          Array.isArray(data.tips) && data.tips.length > 0
            ? data.tips
            : [
                `Showing exercises related to "${finalQuery}".`,
                "Tap any exercise to open its detailed form guide.",
                "Use controlled form and start light.",
              ],
        videoUrl:
          data.videoUrl?.trim() ||
          buildYoutubeUrl(`${finalQuery} exercises`),
        gifUrl: null,
        source: data.source ?? "api",
        exercises: data.exercises,
      };
    }

    const title =
      data.title?.trim() ||
      finalQuery
        .trim()
        .replace(/\s+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());

    const steps =
      Array.isArray(data.steps) && data.steps.length > 0
        ? data.steps
        : currentMode === "diet"
          ? [
              `Search for a simple recipe for "${finalQuery}".`,
              "Prepare the ingredients listed in the recipe.",
              "Follow the cooking steps one by one.",
              "Serve and enjoy.",
            ]
          : [
              `Start with "${finalQuery}" using proper warm-up.`,
              "Keep your form controlled and stable.",
              "Perform the movement through the full safe range.",
              "Rest and repeat with good technique.",
            ];

    const tips =
      Array.isArray(data.tips) && data.tips.length > 0
        ? data.tips
        : currentMode === "diet"
          ? [
              "Use fresh ingredients when possible.",
              "Adjust spice and salt to taste.",
              "Keep portions balanced.",
            ]
          : [
              "Keep your core engaged.",
              "Do not rush the reps.",
              "Stop if you feel sharp pain.",
            ];

    const ingredients =
      Array.isArray(data.ingredients) && data.ingredients.length > 0
        ? data.ingredients
        : undefined;

    const muscles =
      Array.isArray(data.muscles) && data.muscles.length > 0
        ? data.muscles
        : undefined;

    const videoUrl =
      data.videoUrl?.trim() ||
      buildYoutubeUrl(
        currentMode === "diet"
          ? `${finalQuery} recipe`
          : `${finalQuery} workout form`
      );

    return {
      found: data.found ?? true,
      category: data.category ?? currentMode,
      query: data.query ?? finalQuery,
      title,
      ingredients,
      muscles,
      steps,
      tips,
      videoUrl,
      gifUrl: data.gifUrl ?? null,
      source: data.source ?? "api",
      type: "single",
    };
  };

  const fetchHelp = async (customQuery?: string) => {
    const finalQuery = (customQuery ?? query).trim();

    if (!finalQuery) {
      setError("Please enter a food or workout name.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const endpoint = mode === "diet" ? "/api/help/recipe" : "/api/help/workout";

      let data: ApiResponse | null = null;

      try {
        const postRes = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: finalQuery,
            name: finalQuery,
          }),
        });

        const postData = (await postRes.json()) as ApiResponse;

        if (postRes.ok) {
          data = postData;
        } else if (postRes.status !== 405) {
          throw new Error(postData?.error || postData?.message || "Something went wrong");
        }
      } catch {
        // Try GET next.
      }

      if (!data) {
        const url = new URL(endpoint, window.location.origin);
        url.searchParams.set("query", finalQuery);
        url.searchParams.set("name", finalQuery);

        const getRes = await fetch(url.toString(), {
          method: "GET",
        });

        const getData = (await getRes.json()) as ApiResponse;

        if (!getRes.ok) {
          throw new Error(getData?.error || getData?.message || "Something went wrong");
        }

        data = getData;
      }

      if (!data) {
        throw new Error("No data returned from server.");
      }

      const normalized = normalizeResponse(data, finalQuery, mode);
      setResult(normalized);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch help data.");
    } finally {
      setLoading(false);
    }
  };

  const openWorkout = (exerciseName: string) => {
    setMode("workout");
    setQuery(exerciseName);
    fetchHelp(exerciseName);
  };

  const activeCard =
    "bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20";
  const inactiveCard = "bg-slate-100 text-slate-700 dark:text-slate-300 hover:bg-slate-200";

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-6 text-slate-900 dark:text-white md:px-0">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/85 p-6 shadow-sm backdrop-blur-xl md:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Sparkles className="h-4 w-4" />
              FitFusion Help
            </div>

            <Link
              href="/dashboard/home"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-sm font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Recipe help and workout help in one place
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-400 md:text-base">
            Search a food to get ingredients, steps, and a YouTube recipe link.
            Search an exercise or body part to get form guidance, target muscles,
            exercise lists, and demo videos.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/85 p-6 shadow-sm backdrop-blur-xl">
            <div className="mb-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setMode("diet");
                  setResult(null);
                  setError("");
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  mode === "diet" ? activeCard : inactiveCard
                }`}
              >
                <UtensilsCrossed className="h-4 w-4" />
                Diet Help
              </button>

              <button
                onClick={() => {
                  setMode("workout");
                  setResult(null);
                  setError("");
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${
                  mode === "workout" ? activeCard : inactiveCard
                }`}
              >
                <Dumbbell className="h-4 w-4" />
                Workout Help
              </button>
            </div>

            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              {mode === "diet" ? "Food name" : "Exercise name or body part"}
            </label>

            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") fetchHelp();
                  }}
                  placeholder={mode === "diet" ? "Example: lemon rice" : "Example: chest"}
                  className="w-full rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-white py-3 pl-10 pr-4 outline-none transition focus:border-slate-900"
                />
              </div>

              <button
                onClick={() => fetchHelp()}
                disabled={loading}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching
                  </>
                ) : (
                  <>
                    Get Help
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>

            {error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/85 p-6 shadow-sm backdrop-blur-xl">
            <h2 className="text-xl font-bold">
              {mode === "diet" ? "Diet help" : "Workout help"}
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              {mode === "diet"
                ? "Get a simple recipe breakdown with ingredients and steps."
                : "Get exercise form guidance, muscles worked, and body-part exercise lists."}
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <ChefHat className="h-4 w-4 text-purple-600" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">What you get</p>
                </div>
                <ul className="space-y-2 text-sm text-slate-600 dark:text-slate-400">
                  <li>• Clear step-by-step instructions</li>
                  <li>• YouTube search link for demo videos</li>
                  <li>• Body-part searches like chest, core, upper chest, and lower chest return exercise lists</li>
                  <li>• Tap any workout card to open that exact exercise</li>
                </ul>
              </div>
            </div>
          </section>
        </div>

        {result ? (
          <section
            id="result-section"
            className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/85 p-6 shadow-sm backdrop-blur-xl md:p-8"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {result.category === "diet" ? "Diet result" : "Workout result"}
                </p>
                <h3 className="text-2xl font-bold md:text-3xl">{result.title}</h3>
              </div>

              <a
                href={result.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-900 dark:text-white transition hover:bg-slate-100 dark:hover:bg-slate-700"
              >
                <Youtube className="h-4 w-4" />
                Open YouTube
              </a>
            </div>

            {result.category === "workout" && result.type === "list" ? (
              <div className="mt-6">
                <div className="mb-3 flex items-center gap-2">
                  <Target className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Exercises related to {result.query}
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {(result.exercises || []).map((exercise, index) => (
                    <button
                      key={`${exercise.title}-${index}`}
                      onClick={() => {
                        if (exercise.videoUrl) {
                          window.open(exercise.videoUrl, "_blank", "noopener,noreferrer");
                        } else {
                          openWorkout(exercise.title);
                        }
                      }}
                      className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      {exercise.gifUrl ? (
                        <ExerciseGif src={exercise.gifUrl} alt={exercise.title} />
                      ) : (
                        <div className="flex h-44 w-full items-center justify-center rounded-2xl bg-slate-100 dark:bg-slate-700 text-slate-400 dark:text-slate-500">
                          <Dumbbell className="h-10 w-10" />
                        </div>
                      )}

                      <div className="mt-4 flex items-start justify-between gap-3">
                        <div>
                          <h4 className="text-lg font-bold text-slate-900 dark:text-white">
                            {exercise.title}
                          </h4>
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            {exercise.bodyPart}
                          </p>
                        </div>

                        <a
                          href={exercise.videoUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white transition hover:bg-slate-100 dark:hover:bg-slate-700"
                        >
                          <Youtube className="h-3.5 w-3.5" />
                          YouTube
                        </a>
                      </div>

                      <div className="mt-4 flex flex-wrap gap-2">
                        {(exercise.target || []).length > 0
                          ? exercise.target!.map((item) => (
                              <span
                                key={item}
                                className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1 text-xs text-slate-700 dark:text-slate-300"
                              >
                                {item}
                              </span>
                            ))
                          : null}

                        {(exercise.equipment || []).length > 0
                          ? exercise.equipment!.map((item) => (
                              <span
                                key={item}
                                className="rounded-full bg-slate-100 dark:bg-slate-700 px-3 py-1 text-xs text-slate-700 dark:text-slate-300"
                              >
                                {item}
                              </span>
                            ))
                          : null}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {result.gifUrl ? (
                  <div className="mt-6">
                    <ExerciseGif src={result.gifUrl} alt={result.title} />
                  </div>
                ) : null}

                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      {result.category === "diet" ? "Ingredients" : "Muscles worked"}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {(result.ingredients || result.muscles || []).length > 0 ? (
                        (result.category === "diet"
                          ? result.ingredients
                          : result.muscles
                        )!.map((item) => (
                          <span
                            key={item}
                            className="rounded-full bg-white dark:bg-slate-700 px-3 py-1 text-sm text-slate-700 dark:text-slate-300 ring-1 ring-slate-200 dark:ring-slate-600"
                          >
                            {item}
                          </span>
                        ))
                      ) : (
                        <p className="text-sm text-slate-500 dark:text-slate-400">No items listed.</p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Tips</p>
                    <ul className="mt-3 space-y-2 text-sm text-slate-600 dark:text-slate-400">
                      {(result.tips || []).length > 0 ? (
                        result.tips!.map((tip) => <li key={tip}>• {tip}</li>)
                      ) : (
                        <li>• No tips available.</li>
                      )}
                    </ul>
                  </div>
                </div>

                <div className="mt-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 p-4">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    Step-by-step guide
                  </p>
                  <ol className="mt-3 space-y-3 text-sm leading-6 text-slate-700 dark:text-slate-300">
                    {(result.steps || []).map((step, index) => (
                      <li key={index} className="flex gap-3">
                        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                          {index + 1}
                        </span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            )}
          </section>
        ) : null}
      </div>
    </main>
  );
}