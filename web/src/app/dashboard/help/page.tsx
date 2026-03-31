"use client";

import { useMemo, useState } from "react";
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
  Zap,
} from "lucide-react";

type HelpMode = "diet" | "workout";

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
};

export default function HelpPage() {
  const [mode, setMode] = useState<HelpMode>("diet");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HelpResult | null>(null);
  const [error, setError] = useState("");

  const examples = useMemo(
    () => ({
      diet: ["lemon rice", "poha", "paneer bhurji", "banana smoothie"],
      workout: ["bench press", "squats", "deadlift", "push up"],
    }),
    []
  );

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
      const endpoint =
        mode === "diet" ? "/api/help/recipe" : "/api/help/workout";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: finalQuery }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Something went wrong");
      }

      setResult(data);
    } catch (err: any) {
      setError(err?.message || "Failed to fetch help data.");
    } finally {
      setLoading(false);
    }
  };

  const activeCard =
    "bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20";
  const inactiveCard = "bg-slate-100 text-slate-700 hover:bg-slate-200";

  return (
    <main className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 px-4 py-6 text-slate-900 md:px-0">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-xl md:p-8">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700">
              <Sparkles className="h-4 w-4" />
              FitFusion Help
            </div>

            <Link
              href="/dashboard/home"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-medium text-slate-700 transition hover:bg-slate-100"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Link>
          </div>

          <h1 className="text-3xl font-extrabold tracking-tight md:text-4xl">
            Recipe help and workout help in one place
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
            Search a food to get ingredients, steps, and a YouTube recipe link.
            Search an exercise to get form guidance, target muscles, and a demo
            video.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-xl">
            <div className="mb-5 grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  setMode("diet");
                  setResult(null);
                  setError("");
                }}
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${mode === "diet" ? activeCard : inactiveCard}`}
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
                className={`flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold transition ${mode === "workout" ? activeCard : inactiveCard}`}
              >
                <Dumbbell className="h-4 w-4" />
                Workout Help
              </button>
            </div>

            <label className="mb-2 block text-sm font-medium text-slate-700">
              {mode === "diet" ? "Food name" : "Exercise name"}
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
                  placeholder={
                    mode === "diet"
                      ? "Example: lemon rice"
                      : "Example: bench press"
                  }
                  className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-10 pr-4 outline-none transition focus:border-slate-900"
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

            <div className="mt-6">
              <p className="mb-3 text-sm font-semibold text-slate-700">
                Try these examples
              </p>
              <div className="flex flex-wrap gap-2">
                {examples[mode].map((item) => (
                  <button
                    key={item}
                    onClick={() => {
                      setQuery(item);
                      fetchHelp(item);
                    }}
                    className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:bg-slate-100"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-xl">
            <h2 className="text-xl font-bold">
              {mode === "diet" ? "Diet help" : "Workout help"}
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              {mode === "diet"
                ? "Get a simple recipe breakdown with ingredients and steps."
                : "Get exercise form guidance with muscles worked and steps."}
            </p>

            <div className="mt-6 space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <ChefHat className="h-4 w-4 text-purple-600" />
                  <p className="text-sm font-semibold text-slate-700">
                    What you get
                  </p>
                </div>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li>• Clear step-by-step instructions</li>
                  <li>• YouTube search link for demo videos</li>
                  <li>• Easy fallback if the item is not in the local dataset</li>
                </ul>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Zap className="h-4 w-4 text-cyan-600" />
                  <p className="text-sm font-semibold text-slate-700">
                    Best next upgrades
                  </p>
                </div>
                <ul className="space-y-2 text-sm text-slate-600">
                  <li>• Expand the dataset</li>
                  <li>• Add AI-generated recipe/workout fallback</li>
                  <li>• Save favorites in Supabase</li>
                </ul>
              </div>
            </div>
          </section>
        </div>

        {result ? (
          <section className="rounded-3xl border border-slate-200 bg-white/85 p-6 shadow-sm backdrop-blur-xl md:p-8">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500">
                  {result.category === "diet" ? "Diet result" : "Workout result"}
                </p>
                <h3 className="text-2xl font-bold md:text-3xl">
                  {result.title}
                </h3>
              </div>

              <a
                href={result.videoUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-100"
              >
                <Youtube className="h-4 w-4" />
                Open YouTube
              </a>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-700">
                  {result.category === "diet" ? "Ingredients" : "Muscles worked"}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(result.ingredients || result.muscles || []).length > 0 ? (
                    (result.ingredients || result.muscles || []).map((item) => (
                      <span
                        key={item}
                        className="rounded-full bg-white px-3 py-1 text-sm text-slate-700 ring-1 ring-slate-200"
                      >
                        {item}
                      </span>
                    ))
                  ) : (
                    <p className="text-sm text-slate-500">No items listed.</p>
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-semibold text-slate-700">Tips</p>
                <ul className="mt-3 space-y-2 text-sm text-slate-600">
                  {(result.tips || []).length > 0 ? (
                    result.tips!.map((tip) => <li key={tip}>• {tip}</li>)
                  ) : (
                    <li>• No tips available.</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="mt-6 rounded-2xl bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-700">
                Step-by-step guide
              </p>
              <ol className="mt-3 space-y-3 text-sm leading-6 text-slate-700">
                {result.steps.map((step, index) => (
                  <li key={index} className="flex gap-3">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}