import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }

  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

function getGroqClient() {
  return new Groq({
    apiKey: process.env.GROQ_API_KEY!, // ✅ FIXED
  })
}

function extractJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")

  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response does not contain valid JSON")
  }

  const jsonText = cleaned.slice(firstBrace, lastBrace + 1)
  return JSON.parse(jsonText)
}

// 🔥 normalize AI output
function normalizePlan(plan: any) {
  return {
    diet_plan: {
      meals: plan?.diet_plan?.meals ?? [],
      daily_total_calories:
        typeof plan?.diet_plan?.daily_total_calories === "number"
          ? plan.diet_plan.daily_total_calories
          : null,
    },
    workout_plan: Array.isArray(plan?.workout_plan)
      ? plan.workout_plan
      : [],
  }
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const groq = getGroqClient()

    const body = await req.json()
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single()

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 })
    }

    const prompt = `You are an expert fitness coach.

Return STRICT JSON ONLY:

{
  "diet_plan": { "meals": [], "daily_total_calories": 1800 },
  "workout_plan": []
}

User:
Age: ${profile.age}
Goal: ${profile.goal}
Weight: ${profile.weight}
Height: ${profile.height}
Activity: ${profile.activity_level}
`

    const response = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
    })

    const raw = response.choices[0]?.message?.content?.trim()

    if (!raw) throw new Error("AI failed")

    const parsed = extractJson(raw)

    // 🔥 normalize structure
    const plan = normalizePlan(parsed)

    const today = new Date().toISOString().split("T")[0]

    // ✅ ONLY ONE TABLE USED
    const { error } = await supabase.from("workout_plans").insert({
      user_id: userId,
      date: today,
      plan,
    })

    if (error) {
      console.warn("Plan save warning:", error)
    }

    return NextResponse.json({ plan })
  } catch (error: any) {
    console.error("GENERATE PLAN ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to generate plan" },
      { status: 500 }
    )
  }
}