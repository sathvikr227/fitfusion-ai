import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing")
  return new OpenAI({ apiKey })
}

function getSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.replace("Bearer ", "")
    const {
      data: { user },
      error: authError,
    } = await getSupabase().auth.getUser(token)
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await req.formData()
    const file = (formData as unknown as { get(name: string): FormDataEntryValue | null }).get("image") as File | null

    if (!file) {
      return NextResponse.json({ error: "No image provided" }, { status: 400 })
    }

    // Convert file to base64
    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString("base64")
    const mimeType = file.type || "image/jpeg"

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${base64}`,
                detail: "low",
              },
            },
            {
              type: "text",
              text: `Analyze this physique/body image and return a structured JSON fitness plan recommendation.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "physiqueType": "string (e.g. Athletic, Lean, Muscular, Slim, Bulky, etc.)",
  "estimatedBodyFat": "string (e.g. '10-12%', '15-18%', '20-25%')",
  "muscleLevel": "string (Lean / Athletic / Muscular / Very Muscular)",
  "primaryGoal": "string (one of: lose_fat, build_muscle, recomposition, maintain)",
  "suggestedTargetBodyFat": number (realistic target body fat % as a number),
  "observations": ["array", "of", "3-4 key physique observations"],
  "workoutFocus": "string (e.g. 'Hypertrophy training with compound lifts')",
  "dietApproach": "string (e.g. 'High protein caloric surplus for muscle gain')",
  "estimatedTimeToAchieve": "string (e.g. '6-12 months with consistent training')",
  "keyMuscleGroups": ["array", "of", "muscle groups to prioritize"],
  "inspiration": "string (1-2 sentence motivational note about this physique goal)"
}

If the image does not show a human body or physique, return: {"error": "Please upload a photo showing a physique or body type to analyze."}`,
            },
          ],
        },
      ],
      max_tokens: 600,
    })

    const content = response.choices[0]?.message?.content ?? ""

    let analysis: any
    try {
      // Strip possible markdown code fences
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
      analysis = JSON.parse(cleaned)
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response" }, { status: 500 })
    }

    if (analysis.error) {
      return NextResponse.json({ error: analysis.error }, { status: 400 })
    }

    return NextResponse.json({ analysis })
  } catch (err: any) {
    console.error("analyze-inspiration error:", err)
    return NextResponse.json({ error: err.message || "Something went wrong" }, { status: 500 })
  }
}
