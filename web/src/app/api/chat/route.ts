import { NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

// Use environment variable instead of hardcoded string
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY, 
})

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function extractJson(text: string) {
  const trimmed = text.trim()
  const firstBrace = trimmed.indexOf("{")
  const lastBrace = trimmed.lastIndexOf("}")

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("AI response does not contain valid JSON")
  }

  const jsonText = trimmed.slice(firstBrace, lastBrace + 1)
  return JSON.parse(jsonText)
}

export async function POST(req: Request) {
  try {
    const { message, currentPlan, sessionId } = await req.json()

    if (!message || !currentPlan) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 })
    }

    const validSessionId = sessionId || null

    let history: Array<{ role: "user" | "assistant" | "system"; content: string }> =
      []
    let userId: string | null = null

    if (validSessionId) {
      const { data: session, error: sessionError } = await supabase
        .from("chat_sessions")
        .select("id, user_id")
        .eq("id", validSessionId)
        .maybeSingle()

      if (sessionError || !session) {
        return NextResponse.json(
          { error: "Chat session not found" },
          { status: 404 }
        )
      }

      userId = session.user_id

      const { data: historyData, error: historyError } = await supabase
        .from("chat_messages")
        .select("role, content")
        .eq("session_id", validSessionId)
        .order("created_at", { ascending: true })

      if (historyError) {
        console.warn("Chat history fetch warning:", historyError)
      }

      history = (historyData || []).map((msg: any) => ({
        role: msg.role as "user" | "assistant" | "system",
        content: msg.content as string,
      }))
    }

    const messages: Array<{
      role: "user" | "assistant" | "system"
      content: string
    }> = [
      {
        role: "system",
        content: `
You are a professional AI fitness coach.
You must modify the existing plan based on the user's request.
Return STRICT JSON ONLY, no markdown, no explanation, no extra text.
Use exactly this structure:
{
  "diet_plan": {
    "meals": [
      {
        "name": "Breakfast",
        "items": [
          { "food": "Eggs", "calories": 200, "protein": 20 }
        ],
        "total_calories": 300
      }
    ],
    "daily_total_calories": 1800
  },
  "workout_plan": [
    {
      "day": "Monday",
      "type": "Chest",
      "exercises": [
        { "name": "Bench Press", "sets": 3, "reps": 10 }
      ],
      "estimated_calories_burned": 350
    }
  ]
}
        `.trim(),
      },
      {
        role: "user",
        content: `CURRENT PLAN:\n${JSON.stringify(currentPlan)}`,
      },
      ...history,
      {
        role: "user",
        content: message,
      },
    ]

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: messages as any,
      temperature: 0.5,
    })

    const raw = completion.choices[0]?.message?.content?.trim()

    if (!raw) {
      throw new Error("No response from AI")
    }

    const plan = extractJson(raw)

    if (userId) {
      const { error: savePlanError } = await supabase.from("plans").insert({
        user_id: userId,
        plan,
      })

      if (savePlanError) {
        console.warn("Plan save warning:", savePlanError)
      }
    }

    if (validSessionId) {
      const { error: saveChatError } = await supabase
        .from("chat_messages")
        .insert([
          {
            session_id: validSessionId,
            role: "user",
            content: message,
          },
          {
            session_id: validSessionId,
            role: "assistant",
            content: JSON.stringify(plan),
          },
        ])

      if (saveChatError) {
        console.warn("Chat save warning:", saveChatError)
      }
    }

    return NextResponse.json({ plan, sessionId: validSessionId })
  } catch (error: any) {
    console.error("CHAT ERROR:", error)
    return NextResponse.json(
      { error: error.message || "Failed to process chat" },
      { status: 500 }
    )
  }
}