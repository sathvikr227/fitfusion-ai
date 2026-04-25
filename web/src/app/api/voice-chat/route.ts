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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Supabase environment variables are missing")
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey)
}

export async function POST(req: Request) {
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

    const groq = getGroqClient()
    const { message, planSummary, history } = await req.json()

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 })
    }

    const systemPrompt = `You are a friendly, knowledgeable AI fitness coach named FitFusion. Answer conversationally in 1-3 short sentences. Do NOT output JSON or structured data — only plain natural language. Be encouraging and specific.${planSummary ? `\n\nUser's current fitness plan: ${planSummary}` : ""}`

    // Include conversation history for multi-turn context (exclude the current message which is the last item)
    const conversationHistory: Array<{ role: "user" | "assistant" | "system"; content: string }> =
      Array.isArray(history) && history.length > 1
        ? history.slice(0, -1).map((m: { role: string; content: string }) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          }))
        : []

    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      { role: "system", content: systemPrompt },
      ...conversationHistory,
      { role: "user", content: message },
    ]

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_tokens: 150,
    })

    const reply = completion.choices[0]?.message?.content?.trim() || "I didn't get that. Please try again."

    return NextResponse.json({ reply })
  } catch (error: any) {
    console.error("VOICE CHAT ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process voice message" },
      { status: 500 }
    )
  }
}
