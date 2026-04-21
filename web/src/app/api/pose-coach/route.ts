import { NextRequest, NextResponse } from "next/server"
import Groq from "groq-sdk"
import { createClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

function getGroq() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error("GROQ_API_KEY missing")
  return new Groq({ apiKey: key })
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const srv = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !srv) throw new Error("Supabase env missing")
  return createClient(url, srv)
}

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") ?? ""
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null

    let userId: string | null = null
    if (token) {
      const supabase = getSupabase()
      const { data: { user } } = await supabase.auth.getUser(token)
      userId = user?.id ?? null
    }

    const body = await req.json()
    const {
      exerciseName,
      totalReps,
      avgRomPct,
      avgTempoSec,
      targetTempoSec,
      rejectedReps,
      holdSeconds,
      formErrorCounts,
      save = false,
    } = body ?? {}

    if (!exerciseName) {
      return NextResponse.json({ error: "exerciseName required" }, { status: 400 })
    }

    const errorSummary = Object.entries(formErrorCounts ?? {})
      .map(([k, v]) => `- ${k}: ${v} time(s)`)
      .join("\n") || "- None detected"

    const prompt = `You are an expert personal fitness coach. Give short, specific, encouraging feedback on this workout set. Under 110 words, 3 short paragraphs, no lists, no emojis.

Exercise: ${exerciseName}
Valid reps: ${totalReps}
Rejected attempts: ${rejectedReps ?? 0}
${holdSeconds != null ? `Hold duration: ${holdSeconds}s\n` : ""}Avg range of motion: ${avgRomPct}%
Avg tempo: ${avgTempoSec}s/rep (target ~${targetTempoSec ?? 2.5}s)
Form issues detected:
${errorSummary}

Paragraph 1: What went well. Paragraph 2: The #1 thing to fix next set (be concrete). Paragraph 3: One cue to think about during the next reps.`

    const groq = getGroq()
    const resp = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.6,
      max_tokens: 260,
    })

    const feedback = resp.choices[0]?.message?.content?.trim() ?? ""

    // Optional persistence — only if user is authed and client opted in.
    if (save && userId) {
      try {
        const supabase = getSupabase()
        await supabase.from("pose_sessions").insert({
          user_id: userId,
          exercise_id: body.exerciseId ?? exerciseName,
          exercise_name: exerciseName,
          total_reps: totalReps ?? 0,
          rejected_reps: rejectedReps ?? 0,
          avg_rom_pct: avgRomPct ?? 0,
          avg_tempo_sec: avgTempoSec ?? 0,
          hold_seconds: holdSeconds ?? null,
          form_error_counts: formErrorCounts ?? {},
          ai_feedback: feedback,
        })
      } catch {
        // Non-fatal — table may not exist yet.
      }
    }

    return NextResponse.json({ feedback })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to generate feedback" }, { status: 500 })
  }
}
