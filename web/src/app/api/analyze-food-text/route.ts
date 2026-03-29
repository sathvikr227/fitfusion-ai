import { NextResponse } from "next/server"

export const runtime = "nodejs"

type AnalyzeFoodTextBody = {
  food?: string
  quantity?: string
  mealType?: string
}

type NutritionResult = {
  food: string
  quantity: string
  calories: number
  protein: number
  carbs: number
  fat: number
  confidence: number
  notes: string
}

const GROQ_MODEL = process.env.GROQ_TEXT_MODEL ?? "llama-3.1-8b-instant"

function extractJson(text: string) {
  const cleaned = text
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")

  const firstBrace = cleaned.indexOf("{")
  const lastBrace = cleaned.lastIndexOf("}")

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON found in model response")
  }

  return cleaned.slice(firstBrace, lastBrace + 1)
}

function toNumber(value: unknown, fallback = 0) {
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function normalizeResult(parsed: Partial<NutritionResult>): NutritionResult {
  return {
    food: String(parsed.food ?? "Unknown food"),
    quantity: String(parsed.quantity ?? "1 serving"),
    calories: Math.round(toNumber(parsed.calories, 0)),
    protein: Math.round(toNumber(parsed.protein, 0)),
    carbs: Math.round(toNumber(parsed.carbs, 0)),
    fat: Math.round(toNumber(parsed.fat, 0)),
    confidence: Math.max(0, Math.min(100, Math.round(toNumber(parsed.confidence, 70)))),
    notes: String(
      parsed.notes ??
        "Estimated from text. Values are approximate and may vary by brand, recipe, and portion size."
    ),
  }
}

async function callGroq(food: string, quantity?: string, mealType?: string) {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      temperature: 0.2,
      max_tokens: 500,
      messages: [
        {
          role: "system",
          content:
            "You are a nutrition estimation engine. Return only valid JSON. No markdown, no code fences, no explanation.",
        },
        {
          role: "user",
          content: `
Estimate nutrition for the following food entry.

Food: ${food}
Quantity: ${quantity?.trim() || "1 serving"}
${mealType ? `Meal type: ${mealType}` : ""}

Return ONLY this JSON shape:
{
  "food": "food name",
  "quantity": "portion description",
  "calories": number,
  "protein": number,
  "carbs": number,
  "fat": number,
  "confidence": number,
  "notes": "short note"
}

Rules:
- Calories must be in kcal.
- Protein, carbs, and fat must be in grams.
- Use the best realistic estimate for the quantity given.
- If quantity is missing, assume 1 serving.
`.trim(),
        },
      ],
    }),
  })

  const raw = await response.text()

  if (!response.ok) {
    throw new Error(`Groq error ${response.status}: ${raw}`)
  }

  const json = JSON.parse(raw)
  const content = json?.choices?.[0]?.message?.content

  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part: any) => part?.text ?? part?.content ?? "").join("")
        : ""

  const parsed = JSON.parse(extractJson(text))
  return normalizeResult(parsed)
}

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json({ error: "GROQ_API_KEY is missing" }, { status: 500 })
    }

    const body = (await req.json()) as AnalyzeFoodTextBody
    const food = body?.food?.trim()

    if (!food) {
      return NextResponse.json({ error: "Food name is required" }, { status: 400 })
    }

    const result = await callGroq(food, body?.quantity, body?.mealType)
    return NextResponse.json(result)
  } catch (err: any) {
    console.error("analyze-food-text error:", err)

    return NextResponse.json(
      {
        food: "Unknown food",
        quantity: "1 serving",
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        confidence: 0,
        notes: err?.message ?? "Failed to analyze food text",
      },
      { status: 500 }
    )
  }
}