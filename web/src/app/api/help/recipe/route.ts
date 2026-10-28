import { NextResponse } from "next/server"
import { requireUser } from "../../../../lib/supabase/require-user"
import Groq from "groq-sdk"
import { groqJson } from "../../../../lib/groq-json"

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
  const user = await requireUser(req)
  if (user instanceof NextResponse) return user
  let query = ""
  try {
    const body = await req.json()
    query = String(body?.query || "").trim()

    if (!query) {
      return NextResponse.json({ error: "Query is required" }, { status: 400 })
    }

    const groq = getGroqClient()

    const prompt = `You are a culinary expert. Generate a clear, healthy recipe for "${query}".

Respond ONLY with valid JSON in this exact format:
{
  "title": "Recipe name",
  "ingredients": ["ingredient 1 with quantity", "ingredient 2 with quantity"],
  "steps": ["Step 1", "Step 2", "Step 3"],
  "tips": ["Tip 1", "Tip 2"],
  "calories_estimate": "approximate calories per serving"
}`

    const raw = await groqJson(groq, {
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
      maxTokens: 1500,
    })
    const jsonStr = extractJson(raw)
    const recipe = JSON.parse(jsonStr)

    return NextResponse.json({
      found: true,
      category: "diet",
      query,
      title: recipe.title || query,
      ingredients: recipe.ingredients || [],
      steps: recipe.steps || [],
      tips: recipe.tips || [],
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " recipe")}`,
    })
  } catch (error: any) {
    console.error("Recipe help error:", error)
    // Graceful fallback — use `query` captured before the error
    return NextResponse.json({
      found: false,
      category: "diet",
      query,
      title: "Recipe not found",
      ingredients: [],
      steps: ["Could not generate recipe. Please try a different food name."],
      tips: ["Try searching on YouTube using the link below."],
      videoUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " recipe")}`,
    })
  }
}
