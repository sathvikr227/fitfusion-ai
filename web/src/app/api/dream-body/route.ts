import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"
import { groqJson } from "../../../lib/groq-json"

export const runtime = "nodejs"

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is missing")
  return new Groq({ apiKey })
}

function getSupabase(token?: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase environment variables are missing")
  }
  // With the user's token, reads run under their row-level security.
  return createClient(supabaseUrl, supabaseAnonKey, token
    ? { global: { headers: { Authorization: `Bearer ${token}` } } }
    : undefined)
}

function trainingDaysFrom(profile: { days_off?: unknown; rest_days_per_week?: unknown } | null): number {
  const rest = Number(profile?.days_off ?? profile?.rest_days_per_week)
  if (!Number.isFinite(rest) || rest < 0 || rest > 6) return 4
  return Math.max(1, 7 - rest)
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  if (obj) return obj[0]
  return text.trim()
}

export async function POST(req: Request) {
  const authHeader = req.headers.get("Authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const token = authHeader.slice("Bearer ".length)
    const {
      data: { user },
      error: authError,
    } = await getSupabase().auth.getUser(token)

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const groq = getGroqClient()
    const body = await req.json()

    // The roadmap ignored the user's diet and injuries, and its "days per week"
    // didn't match its own day list. Read them from the profile and enforce.
    const { data: profile } = await getSupabase(token)
      .from("profiles")
      .select("diet_preference, dietary_restrictions, injuries, days_off, rest_days_per_week")
      .eq("id", user.id)
      .maybeSingle()
    const trainingDays = trainingDaysFrom(profile)
    const diet = String(profile?.diet_preference ?? "").trim() || "no preference"
    const restrictions = Array.isArray(profile?.dietary_restrictions) ? profile.dietary_restrictions.join(", ") : ""
    const injuryText = String(profile?.injuries ?? "").trim()
    const hasInjury = injuryText !== "" && !["no", "none", "na", "n/a", "nil"].includes(injuryText.toLowerCase())
    const {
      currentWeight,
      currentBodyFat,
      targetWeight,
      targetBodyFat,
      heightCm,
      age,
      gender,
      activityLevel,
      goal,
      timeframeWeeks,
    } = body

    const prompt = `You are an expert fitness coach and nutritionist. Generate a detailed, realistic "Dream Body" transformation roadmap in JSON.

User Profile:
- Current weight: ${currentWeight} kg
- Target weight: ${targetWeight} kg
- Current body fat: ${currentBodyFat ? currentBodyFat + "%" : "unknown"}
- Target body fat: ${targetBodyFat ? targetBodyFat + "%" : "not specified"}
- Height: ${heightCm ? heightCm + " cm" : "not provided"}
- Age: ${age || "not provided"}
- Gender: ${gender || "not provided"}
- Activity level: ${activityLevel}
- Primary goal: ${goal}
- Timeframe: ${timeframeWeeks} weeks
- Diet: ${diet}${restrictions ? ` (restrictions: ${restrictions})` : ""}
- Injuries / limitations: ${hasInjury ? injuryText : "none"}
- Training days per week available: ${trainingDays}

Hard rules:
- Every food suggestion and tip must fit the diet above (Vegetarian = no meat, fish or egg; Eggetarian allows egg; Vegan = no animal products).
- ${hasInjury ? `Do not suggest exercises that load the injured area (${injuryText}); suggest safe alternatives.` : "No injury constraints."}
- workoutSplit.daysPerWeek must be exactly ${trainingDays} and workoutSplit.structure must list exactly ${trainingDays} training days.

Respond ONLY with valid JSON matching this exact schema:
{
  "feasibility": {
    "rating": "excellent" | "good" | "challenging" | "aggressive",
    "message": "short honest assessment of the goal",
    "weeklyWeightChange": number (kg per week, negative for loss)
  },
  "dailyCalories": number,
  "macros": {
    "protein": number (grams),
    "carbs": number (grams),
    "fat": number (grams)
  },
  "workoutSplit": {
    "daysPerWeek": number,
    "focus": string,
    "structure": ["Day 1: ...", "Day 2: ...", ...]
  },
  "milestones": [
    { "week": number, "weight": number, "milestone": "description" }
  ],
  "tips": ["tip1", "tip2", "tip3", "tip4", "tip5"],
  "warnings": ["warning1"] (only if goal is aggressive or unrealistic — omit otherwise)
}`

    const raw = await groqJson(groq, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxTokens: 2000,
    })
    if (!raw.trim()) {
      throw new Error("Groq returned an empty response")
    }
    const jsonStr = extractJson(raw)
    let roadmap: any
    try {
      roadmap = JSON.parse(jsonStr)
    } catch {
      throw new Error("Could not parse AI-generated roadmap as valid JSON")
    }

    if (roadmap?.workoutSplit) {
      const structure = Array.isArray(roadmap.workoutSplit.structure) ? roadmap.workoutSplit.structure : []
      roadmap.workoutSplit.structure = structure.slice(0, trainingDays)
      roadmap.workoutSplit.daysPerWeek = roadmap.workoutSplit.structure.length || trainingDays
    }

    return NextResponse.json({ roadmap })
  } catch (error: any) {
    console.error("DREAM BODY ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to generate roadmap" },
      { status: 500 }
    )
  }
}
