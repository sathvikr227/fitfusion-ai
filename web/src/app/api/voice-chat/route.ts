import { NextResponse } from "next/server"
import Groq from "groq-sdk"

export const runtime = "nodejs"

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey) throw new Error("GROQ_API_KEY is missing")
  return new Groq({ apiKey })
}

export async function POST(req: Request) {
  try {
    const groq = getGroqClient()
    const { message, planSummary } = await req.json()

    if (!message) {
      return NextResponse.json({ error: "Missing message" }, { status: 400 })
    }

    const messages: Array<{ role: "user" | "assistant" | "system"; content: string }> = [
      {
        role: "system",
        content: `You are a friendly AI fitness coach. Answer the user's question conversationally in 1-3 short sentences. Do NOT output JSON or structured data — only plain natural language. Be encouraging and specific.${planSummary ? `\n\nUser's current plan summary: ${planSummary}` : ""}`,
      },
      {
        role: "user",
        content: message,
      },
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
