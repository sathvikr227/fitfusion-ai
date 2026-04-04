"use client"

import { useEffect, useRef, useState } from "react"
import { Mic, MicOff, X, Volume2 } from "lucide-react"
import { supabase } from "../lib/supabase/client"

type Msg = { role: "user" | "assistant"; text: string }

export default function VoiceAssistant() {
  const [open, setOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [transcript, setTranscript] = useState("")
  const [messages, setMessages] = useState<Msg[]>([])
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [currentPlan, setCurrentPlan] = useState<string>("")
  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const synthRef = useRef<SpeechSynthesis | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // init session + plan on open
  useEffect(() => {
    if (!open) return
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: s } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (s?.id) setSessionId(s.id)

      const { data: plan } = await supabase
        .from("workout_plans")
        .select("plan")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (plan?.plan) {
        setCurrentPlan(typeof plan.plan === "string" ? plan.plan : JSON.stringify(plan.plan))
      }
    }
    init()
    synthRef.current = window.speechSynthesis
  }, [open])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, loading])

  const speak = (text: string) => {
    if (!synthRef.current) return
    synthRef.current.cancel()
    const utter = new SpeechSynthesisUtterance(text)
    utter.rate = 1.05
    utter.pitch = 1
    utter.onstart = () => setSpeaking(true)
    utter.onend = () => setSpeaking(false)
    synthRef.current.speak(utter)
  }

  const stopSpeaking = () => {
    synthRef.current?.cancel()
    setSpeaking(false)
  }

  const startListening = () => {
    setError(null)
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError("Speech recognition not supported in this browser. Try Chrome.")
      return
    }

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition
    recognition.lang = "en-US"
    recognition.interimResults = false
    recognition.maxAlternatives = 1

    recognition.onstart = () => setListening(true)
    recognition.onend = () => setListening(false)
    recognition.onerror = (e: SpeechRecognitionErrorEvent) => {
      setListening(false)
      if (e.error !== "no-speech") setError(`Mic error: ${e.error}`)
    }
    recognition.onresult = (e: SpeechRecognitionEvent) => {
      const text = e.results[0][0].transcript
      setTranscript(text)
      sendMessage(text)
    }

    recognition.start()
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setListening(false)
  }

  const buildPlanSummary = (planJson: string): string => {
    try {
      const plan = typeof planJson === "string" ? JSON.parse(planJson) : planJson
      const workoutDays = plan.workout_plan?.length ?? 0
      const calories = plan.diet_plan?.daily_total_calories ?? null
      const meals = plan.diet_plan?.meals?.length ?? 0
      return `${workoutDays} workout days per week, ${meals} meals per day${calories ? `, targeting ${calories} kcal/day` : ""}.`
    } catch {
      return ""
    }
  }

  const sendMessage = async (text: string) => {
    if (!text.trim()) return
    setLoading(true)
    setTranscript("")

    const userMsg: Msg = { role: "user", text }
    setMessages((prev) => [...prev, userMsg])

    try {
      const planSummary = currentPlan ? buildPlanSummary(currentPlan) : ""

      const res = await fetch("/api/voice-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, planSummary }),
      })

      if (!res.ok) throw new Error("AI request failed")

      const data = await res.json()
      const reply = data.reply || "Sorry, I couldn't understand that."

      setMessages((prev) => [...prev, { role: "assistant", text: reply }])
      speak(reply)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to get response"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-all duration-200 ${
          open
            ? "bg-slate-700 text-white"
            : "bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:scale-105"
        }`}
        title="Voice Assistant"
      >
        {open ? <X className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
      </button>

      {/* Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex w-80 flex-col rounded-3xl border border-slate-200 bg-white shadow-2xl md:w-96">
          {/* Header */}
          <div className="flex items-center gap-3 rounded-t-3xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <Mic className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">FitFusion Voice</p>
              <p className="text-xs text-white/70">Ask me anything about your fitness</p>
            </div>
            {speaking && (
              <Volume2 className="ml-auto h-4 w-4 animate-pulse text-white" />
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex max-h-72 flex-col gap-2 overflow-y-auto p-4"
          >
            {messages.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-400">
                Tap the mic and ask something like:<br />
                <span className="font-medium text-slate-600">"What's my workout today?"</span><br />
                <span className="font-medium text-slate-600">"How many calories should I eat?"</span>
              </div>
            )}
            {messages.map((msg, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                  msg.role === "user"
                    ? "ml-auto bg-purple-600 text-white"
                    : "bg-slate-100 text-slate-900"
                }`}
              >
                {msg.text || (loading && i === messages.length - 1 ? "..." : "")}
              </div>
            ))}
            {loading && messages[messages.length - 1]?.role === "user" && (
              <div className="max-w-[85%] rounded-2xl bg-slate-100 px-3 py-2 text-sm text-slate-400">
                Thinking...
              </div>
            )}
          </div>

          {/* Transcript preview */}
          {transcript && (
            <div className="mx-4 rounded-xl bg-purple-50 px-3 py-2 text-xs text-purple-700">
              {transcript}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mx-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-600">
              {error}
            </div>
          )}

          {/* Controls */}
          <div className="flex items-center gap-3 rounded-b-3xl border-t border-slate-100 p-4">
            <button
              onMouseDown={startListening}
              onMouseUp={stopListening}
              onTouchStart={startListening}
              onTouchEnd={stopListening}
              disabled={loading}
              className={`flex flex-1 items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium transition-all ${
                listening
                  ? "bg-rose-500 text-white shadow-lg"
                  : "bg-gradient-to-r from-purple-600 to-cyan-500 text-white hover:opacity-90 disabled:opacity-50"
              }`}
            >
              {listening ? (
                <><MicOff className="h-4 w-4" /> Listening...</>
              ) : (
                <><Mic className="h-4 w-4" /> Hold to speak</>
              )}
            </button>

            {speaking && (
              <button
                onClick={stopSpeaking}
                className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                title="Stop speaking"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}
