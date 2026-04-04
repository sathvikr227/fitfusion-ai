import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is missing")
  return new Groq({ apiKey })
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase env vars missing")
  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    const { userId } = await req.json()
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 })
    }

    const supabase = getSupabase()
    const groq = getGroqClient()

    const { data: planRow } = await supabase
      .from("workout_plans")
      .select("plan")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!planRow?.plan) {
      return NextResponse.json(
        { error: "No plan found. Generate a fitness plan first." },
        { status: 404 }
      )
    }

    let dietPlan: unknown = null
    try {
      const parsed =
        typeof planRow.plan === "string" ? JSON.parse(planRow.plan) : planRow.plan
      dietPlan = (parsed as Record<string, unknown>)?.diet_plan ?? null
    } catch {
      return NextResponse.json({ error: "Invalid plan format" }, { status: 400 })
    }

    if (!dietPlan) {
      return NextResponse.json(
        { error: "No diet plan found in your current plan." },
        { status: 404 }
      )
    }

    const prompt = `You are a nutritionist. Based on the following diet plan, generate a smart weekly grocery list.

Diet Plan:
${JSON.stringify(dietPlan, null, 2)}

Rules:
- Organize items by category: Proteins, Vegetables, Fruits, Grains & Carbs, Dairy & Eggs, Nuts & Seeds, Pantry & Condiments
- Consolidate duplicate ingredients that appear across meals
- Estimate weekly quantities (7 days worth)
- Be specific and practical with quantities (e.g. "500g", "1 dozen", "2 cups", "1 bottle")
- Only include categories that have items

Return ONLY a valid JSON object with this exact structure, no extra text:
{
  "groceries": [
    {
      "category": "Proteins",
      "items": [
        { "name": "Chicken breast", "qty": "700g" },
        { "name": "Eggs", "qty": "12 pcs" }
      ]
    }
  ]
}`

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1200,
      response_format: { type: "json_object" },
    })

    const content = completion.choices[0]?.message?.content ?? "{}"

    let result: { groceries?: unknown[] }
    try {
      result = JSON.parse(content)
    } catch {
      return NextResponse.json(
        { error: "Failed to parse grocery list from AI" },
        { status: 500 }
      )
    }

    if (!result.groceries) {
      return NextResponse.json(
        { error: "Unexpected AI response format" },
        { status: 500 }
      )
    }

    return NextResponse.json(result)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
