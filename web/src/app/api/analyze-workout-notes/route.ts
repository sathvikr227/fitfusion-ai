import { NextRequest, NextResponse } from "next/server"

const DEFAULTS = {
  effortLevel: 5,
  fatigueLevel: "moderate",
  muscleGroups: [],
  painSignals: [],
  mood: "neutral",
  keyInsight: "No notes provided — tracking started.",
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const notes: string = body?.notes ?? ""

    if (!notes || notes.trim().length < 10) {
      return NextResponse.json(DEFAULTS)
    }

    const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        temperature: 0.2,
        max_tokens: 512,
        messages: [
          {
            role: "system",
            content: `You are a fitness analytics assistant. Extract structured data from free-text workout notes.
Return ONLY valid JSON with no markdown fences, no extra text, no explanation.
Schema:
{
  "effortLevel": <integer 1-10>,
  "fatigueLevel": <"low"|"moderate"|"high">,
  "muscleGroups": <string[]>,
  "painSignals": <string[]>,
  "mood": <"great"|"good"|"neutral"|"tired"|"bad">,
  "keyInsight": <string, one sentence summary>
}
Rules:
- effortLevel: 1=very easy, 10=maximum effort
- fatigueLevel: low if energized, moderate if neutral, high if exhausted
- muscleGroups: only muscles actually mentioned or clearly implied (e.g. "bench press" → chest, shoulders, triceps)
- painSignals: only actual pain/discomfort mentions, empty array if none
- mood: infer from tone and words used
- keyInsight: concise single sentence capturing the most important takeaway`,
          },
          {
            role: "user",
            content: `Workout notes:\n${notes.trim()}`,
          },
        ],
      }),
    })

    if (!groqRes.ok) {
      const errText = await groqRes.text()
      console.error("Groq API error:", groqRes.status, errText)
      return NextResponse.json(DEFAULTS)
    }

    const groqData = await groqRes.json()
    const raw: string = groqData.choices?.[0]?.message?.content ?? ""

    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```[a-z]*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim()

    let parsed: typeof DEFAULTS
    try {
      parsed = JSON.parse(cleaned)
    } catch {
      console.error("Failed to parse Groq JSON response:", cleaned)
      return NextResponse.json(DEFAULTS)
    }

    // Validate and clamp values
    const effortLevel = Math.min(10, Math.max(1, Math.round(Number(parsed.effortLevel) || 5)))
    const fatigueLevel = ["low", "moderate", "high"].includes(parsed.fatigueLevel)
      ? parsed.fatigueLevel
      : "moderate"
    const muscleGroups = Array.isArray(parsed.muscleGroups)
      ? parsed.muscleGroups.filter((v) => typeof v === "string")
      : []
    const painSignals = Array.isArray(parsed.painSignals)
      ? parsed.painSignals.filter((v) => typeof v === "string")
      : []
    const mood = ["great", "good", "neutral", "tired", "bad"].includes(parsed.mood)
      ? parsed.mood
      : "neutral"
    const keyInsight =
      typeof parsed.keyInsight === "string" && parsed.keyInsight.length > 0
        ? parsed.keyInsight
        : "Workout logged."

    return NextResponse.json({
      effortLevel,
      fatigueLevel,
      muscleGroups,
      painSignals,
      mood,
      keyInsight,
    })
  } catch (err) {
    console.error("analyze-workout-notes error:", err)
    return NextResponse.json(DEFAULTS)
  }
}
