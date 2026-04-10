import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  return createClient(url, key)
}

function getGroq() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY missing")
  return new Groq({ apiKey })
}

function extractJson(text: string) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  const obj = text.match(/\{[\s\S]*\}/)
  return obj ? obj[0] : text.trim()
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.replace("Bearer ", "")

    const supabase = getSupabase()
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await req.json()
    const transcript: string = (body?.transcript ?? "").trim()

    if (!transcript) {
      return NextResponse.json({ error: "No transcript provided" }, { status: 400 })
    }

    const groq = getGroq()

    const prompt = `You are a nutrition expert. Parse this voice message describing food eaten and extract the nutrition data.

Voice message: "${transcript}"

Return ONLY valid JSON:
{
  "description": "human-readable description of what was eaten",
  "calories": estimated total calories as a number,
  "protein": grams of protein as a number,
  "carbs": grams of carbs as a number,
  "fat": grams of fat as a number,
  "items": [
    { "food": "food item name", "amount": "amount eaten", "calories": estimated calories }
  ]
}

Be realistic with estimates. If unsure about a specific item, make a reasonable educated guess.`

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 400,
    })

    const raw = completion.choices[0]?.message?.content ?? ""
    const parsed = JSON.parse(extractJson(raw))

    // Log to meal_logs table
    const today = new Date().toISOString().split("T")[0]
    const { data: logged, error: logErr } = await supabase
      .from("meal_logs")
      .insert({
        user_id: user.id,
        date: today,
        meal_name: parsed.description ?? "Voice log",
        total_calories: parsed.calories ?? 0,
        protein: parsed.protein ?? 0,
        carbs: parsed.carbs ?? 0,
        fat: parsed.fat ?? 0,
        source: "voice",
        items: parsed.items ?? [],
      })
      .select()
      .single()

    return NextResponse.json({
      success: true,
      logged: !logErr,
      description: parsed.description,
      calories: parsed.calories,
      protein: parsed.protein,
      carbs: parsed.carbs,
      fat: parsed.fat,
      items: parsed.items,
    })
  } catch (err: any) {
    console.error("Voice food log error:", err)
    return NextResponse.json({ error: err.message || "Failed to process" }, { status: 500 })
  }
}
