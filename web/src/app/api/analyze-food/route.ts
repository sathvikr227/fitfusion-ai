import { NextResponse } from "next/server"

export const runtime = "nodejs"

const GROQ_MODEL =
  process.env.GROQ_VISION_MODEL ?? "llama-3.2-90b-vision-preview"

function safeParse(text: string) {
  try {
    // remove markdown if present
    const cleaned = text
      .replace(/```json/gi, "")
      .replace(/```/g, "")
      .trim()

    const start = cleaned.indexOf("{")
    const end = cleaned.lastIndexOf("}")

    if (start === -1 || end === -1) throw new Error("Invalid JSON")

    return JSON.parse(cleaned.slice(start, end + 1))
  } catch (e) {
    console.error("JSON parse failed:", text)
    throw new Error("AI returned invalid JSON")
  }
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

    const { image, mealType } = await req.json()

    if (!image) {
      return NextResponse.json(
        { error: "No image provided" },
        { status: 400 }
      )
    }

    console.log("📸 Image received, sending to Groq...")

    const res = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
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
              content:
                "Return ONLY JSON. No explanation. No markdown.",
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `
Identify food and estimate nutrition.

Return JSON:
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

Meal: ${mealType || "general"}
                  `,
                },
                {
                  type: "image_url",
                  image_url: { url: image },
                },
              ],
            },
          ],
        }),
      }
    )

    const raw = await res.text()

    if (!res.ok) {
      console.error("❌ Groq error:", raw)
      throw new Error("Groq API failed")
    }

    const json = JSON.parse(raw)
    const content = json?.choices?.[0]?.message?.content || ""

    const parsed = safeParse(content)

    return NextResponse.json({
      food: parsed.food || "Unknown food",
      quantity: parsed.quantity || "1 serving",
      calories: toNum(parsed.calories),
      protein: toNum(parsed.protein),
      carbs: toNum(parsed.carbs),
      fat: toNum(parsed.fat),
      confidence: toNum(parsed.confidence || 70),
      notes: parsed.notes || "Estimated from image",
    })
  } catch (err: any) {
    console.error("🔥 IMAGE ERROR:", err.message)

    // ✅ graceful fallback (NO MORE UI BREAK)
    return NextResponse.json({
      food: "Unknown food",
      quantity: "1 serving",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
      notes: "Image analysis failed",
    })
  }
}