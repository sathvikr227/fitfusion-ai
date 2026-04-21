import { NextResponse } from "next/server"

export const runtime = "nodejs"

type AiResult = {
  food: string
  quantity: string
  calories: number
  protein: number
  carbs: number
  fat: number
  confidence: number
  notes: string
}

function toNum(v: unknown, fallback = 0) {
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? Math.round(n) : fallback
}

function cleanText(v: unknown) {
  return String(v ?? "").replace(/\s+/g, " ").trim()
}

function fallbackAiResult(food: string): AiResult {
  const f = (food || "").toLowerCase()
  // Very rough category-based defaults to avoid wildly overreporting small foods
  const isFruit = /apple|banana|orange|grape|berry|mango|pear|peach/.test(f)
  const isDrink = /water|tea|coffee|juice/.test(f)
  const isVeg = /salad|lettuce|cucumber|tomato|broccoli|spinach|carrot/.test(f)
  const calories = isFruit ? 80 : isDrink ? 10 : isVeg ? 40 : 250
  const protein = isFruit ? 1 : isDrink ? 0 : isVeg ? 2 : 15
  const carbs = isFruit ? 20 : isDrink ? 2 : isVeg ? 8 : 30
  const fat = isFruit ? 0 : isDrink ? 0 : isVeg ? 0 : 10
  return {
    food: food || "Unknown food",
    quantity: "1 serving",
    calories,
    protein,
    carbs,
    fat,
    confidence: 30,
    notes: "Rough estimate — AI analysis unavailable",
  }
}

function parseMaybeJson(text: string): any {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim()

  try {
    return JSON.parse(cleaned)
  } catch {}

  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    return JSON.parse(match[0])
  }

  throw new Error("Invalid JSON")
}

async function lookupNutrition(food: string, origin: string, mealType?: string) {
  const res = await fetch(`${origin}/api/food-db`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ food, mealType }),
  })

  if (!res.ok) return null
  return res.json()
}

export async function POST(req: Request) {
  try {
    const openaiKey = process.env.OPENAI_API_KEY
    if (!openaiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY missing" },
        { status: 500 }
      )
    }

    const body = await req.json().catch(() => ({}))
    const image = body?.image
    const mealType = body?.mealType

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      )
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "food_image_analysis",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                food: { type: "string" },
                quantity: { type: "string" },
                calories: { type: "number" },
                protein: { type: "number" },
                carbs: { type: "number" },
                fat: { type: "number" },
                confidence: { type: "number" },
                notes: { type: "string" },
              },
              required: ["food", "quantity", "calories", "protein", "carbs", "fat", "confidence", "notes"],
            },
          },
        },
        messages: [
          {
            role: "system",
            content:
              "You are a food image analyzer for a fitness app. Return only valid JSON that matches the schema.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `
Identify the main food in the image and estimate nutrition.

Rules:
- Return the most likely food name, not a full paragraph
- Use a short quantity like "1 bowl", "1 plate", "1 serving", "2 slices"
- If there are multiple items, describe the main meal as a single food label
- Estimate calories and macros for the visible portion
- Be conservative and realistic

Meal type: ${mealType || "general"}
                `.trim(),
              },
              {
                type: "image_url",
                image_url: { url: image },
              },
            ],
          },
        ],
      }),
    })

    const raw = await openaiRes.text()

    if (!openaiRes.ok) {
      console.error("OpenAI image error:", raw)
      return NextResponse.json(fallbackAiResult("Unknown food"))
    }

    const data = JSON.parse(raw)
    const content = data?.choices?.[0]?.message?.content

    let parsed: AiResult
    try {
      const obj = typeof content === "string" ? parseMaybeJson(content) : content
      parsed = {
        food: cleanText(obj?.food) || "Unknown food",
        quantity: cleanText(obj?.quantity) || "1 serving",
        calories: toNum(obj?.calories, 0),
        protein: toNum(obj?.protein, 0),
        carbs: toNum(obj?.carbs, 0),
        fat: toNum(obj?.fat, 0),
        confidence: toNum(obj?.confidence, 50),
        notes: cleanText(obj?.notes) || "Estimated from image",
      }
    } catch (parseErr) {
      console.error("Parse failed:", parseErr)
      parsed = fallbackAiResult("Unknown food")
    }

    const detectedFood = cleanText(parsed.food)

    const origin = new URL(req.url).origin
    const dbData = detectedFood ? await lookupNutrition(detectedFood, origin, mealType) : null

    if (dbData) {
      return NextResponse.json({
        food: dbData.food ?? detectedFood,
        quantity: dbData.quantity ?? parsed.quantity ?? "1 serving",
        calories: toNum(dbData.calories, parsed.calories),
        protein: toNum(dbData.protein, parsed.protein),
        carbs: toNum(dbData.carbs, parsed.carbs),
        fat: toNum(dbData.fat, parsed.fat),
        confidence: Math.max(toNum(parsed.confidence, 50), 55),
        notes: dbData.source ? "Matched with food database" : parsed.notes,
        source: dbData.source ?? "vision+db",
      })
    }

    return NextResponse.json({
      food: detectedFood || "Unknown food",
      quantity: parsed.quantity || "1 serving",
      calories: toNum(parsed.calories, 0) || 250,
      protein: toNum(parsed.protein, 0) || 15,
      carbs: toNum(parsed.carbs, 0) || 20,
      fat: toNum(parsed.fat, 0) || 8,
      confidence: toNum(parsed.confidence, 50),
      notes: parsed.notes || "Estimated from image",
      source: "vision-only",
    })
  } catch (err: any) {
    console.error("FINAL IMAGE ERROR:", err?.message || err)
    return NextResponse.json({
      food: "Unknown food",
      quantity: "1 serving",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
      notes: "Image analysis failed",
      source: "fallback",
    })
  }
}