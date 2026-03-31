import { NextResponse } from "next/server"

export const runtime = "nodejs"

const GROQ_MODEL =
  process.env.GROQ_TEXT_MODEL ?? "llama-3.3-70b-versatile"

function safeParse(text: string) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim()

  const start = cleaned.indexOf("{")
  const end = cleaned.lastIndexOf("}")

  if (start === -1 || end === -1) {
    throw new Error("Invalid JSON from AI")
  }

  return JSON.parse(cleaned.slice(start, end + 1))
}

function toNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "GROQ_API_KEY missing" },
        { status: 500 }
      )
    }

    const { food, quantity, mealType } = await req.json()

    if (!food || !String(food).trim()) {
      return NextResponse.json(
        { error: "Food required" },
        { status: 400 }
      )
    }

    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: "Return ONLY valid JSON. No markdown. No explanation.",
          },
          {
            role: "user",
            content: `
Estimate nutrition for this food.

Food: ${String(food).trim()}
Quantity: ${String(quantity || "1 serving").trim()}
Meal type: ${String(mealType || "general")}

Return JSON exactly in this format:
{
  "food": "",
  "quantity": "",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "confidence": number,
  "notes": ""
}
            `.trim(),
          },
        ],
      }),
    })

    const raw = await res.text()

    if (!res.ok) {
      console.error("Groq text error:", raw)
      throw new Error("Groq text API failed")
    }

    const json = JSON.parse(raw)
    const content = json?.choices?.[0]?.message?.content || ""
    const parsed = safeParse(content)

    return NextResponse.json({
      food: parsed.food || String(food).trim(),
      quantity: parsed.quantity || String(quantity || "1 serving"),
      calories: toNum(parsed.calories),
      protein: toNum(parsed.protein),
      carbs: toNum(parsed.carbs),
      fat: toNum(parsed.fat),
      confidence: toNum(parsed.confidence || 70),
      notes: parsed.notes || "Estimated from text input",
    })
  } catch (err: any) {
    console.error("TEXT ANALYSIS ERROR:", err?.message || err)
    return NextResponse.json(
      {
        error: "Failed to analyze text food",
        food: "Unknown food",
        quantity: "1 serving",
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        confidence: 0,
        notes: "Text analysis failed",
      },
      { status: 200 }
    )
  }
}