import { NextResponse } from "next/server"
import Groq from "groq-sdk"

export const runtime = "nodejs"

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is missing")
  return new Groq({ apiKey })
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
    const groq = getGroqClient()
    const body = await req.json()
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

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      max_tokens: 1200,
    })

    const raw = completion.choices[0]?.message?.content || ""
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

    return NextResponse.json({ roadmap })
  } catch (error: any) {
    console.error("DREAM BODY ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to generate roadmap" },
      { status: 500 }
    )
  }
}
