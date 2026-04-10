"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import { Bot, Send, Loader2, Zap, Flame, Scale, Target, ChevronRight } from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  created_at?: string
}

type UserStats = {
  goal: string | null
  streak: number
  lastWorkout: string | null
  weight: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUGGESTED_QUESTIONS = [
  "How am I doing this week?",
  "Am I making progress?",
  "What should I eat today?",
  "Am I overtraining?",
  "Why is my weight not moving?",
  "What's my best streak?",
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function todayStr() {
  return new Date().toISOString().split("T")[0]
}

function daysAgoStr(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split("T")[0]
}

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AssistantPage() {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState("")
  const [loading, setLoading] = useState(false)
  const [initializing, setInitializing] = useState(true)
  const [accessToken, setAccessToken] = useState<string | null>(null)
  const [userStats, setUserStats] = useState<UserStats>({
    goal: null,
    streak: 0,
    lastWorkout: null,
    weight: null,
  })

  // ── Auth + boot ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function boot() {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser()

        if (!user) {
          router.replace("/login")
          return
        }

        const {
          data: { session },
        } = await supabase.auth.getSession()

        setAccessToken(session?.access_token ?? null)

        const userId = user.id
        const today = todayStr()
        const thirtyDaysAgo = daysAgoStr(30)

        // Load in parallel: past messages + stats data
        const [msgsRes, profileRes, workoutLogsRes, weightLogsRes] =
          await Promise.all([
            supabase
              .from("assistant_messages")
              .select("id, role, content, created_at")
              .eq("user_id", userId)
              .order("created_at", { ascending: true })
              .limit(50),

            supabase
              .from("profiles")
              .select("goal, weight")
              .eq("id", userId)
              .maybeSingle(),

            supabase
              .from("workout_logs")
              .select("date")
              .eq("user_id", userId)
              .gte("date", thirtyDaysAgo)
              .order("date", { ascending: false }),

            supabase
              .from("weight_logs")
              .select("weight")
              .eq("user_id", userId)
              .order("date", { ascending: false })
              .limit(1),
          ])

        // Parse messages
        const existingMessages: Message[] = (msgsRes.data ?? []).map(
          (m: any) => ({
            id: m.id ?? generateId(),
            role: m.role as "user" | "assistant",
            content: m.content as string,
            created_at: m.created_at,
          })
        )
        setMessages(existingMessages)

        // Compute streak
        const workoutDatesSet = new Set(
          (workoutLogsRes.data ?? []).map((w: any) => w.date)
        )
        let streak = 0
        {
          const checkDate = new Date()
          let i = 0
          if (!workoutDatesSet.has(today)) {
            checkDate.setDate(checkDate.getDate() - 1)
            i = 1
          }
          while (i <= 365) {
            const d = checkDate.toISOString().split("T")[0]
            if (workoutDatesSet.has(d)) {
              streak++
              checkDate.setDate(checkDate.getDate() - 1)
            } else {
              break
            }
            i++
          }
        }

        // Last workout date
        const lastWorkout =
          (workoutLogsRes.data ?? [])[0]?.date ?? null

        // Current weight (from weight_logs if available, else profile)
        const latestWeight =
          (weightLogsRes.data ?? [])[0]?.weight ?? profileRes.data?.weight ?? null

        setUserStats({
          goal: profileRes.data?.goal ?? null,
          streak,
          lastWorkout,
          weight: latestWeight ? `${latestWeight} kg` : null,
        })
      } catch (err) {
        console.error("Assistant boot error:", err)
      } finally {
        setInitializing(false)
      }
    }

    boot()
  }, [router])

  // ── Auto-scroll ────────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  // ── Send message ───────────────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || loading || !accessToken) return

      const userMsg: Message = {
        id: generateId(),
        role: "user",
        content: trimmed,
      }

      setMessages((prev) => [...prev, userMsg])
      setInputText("")
      setLoading(true)

      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto"
      }

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ message: trimmed }),
        })

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}))
          throw new Error(errData?.error ?? `Request failed with status ${res.status}`)
        }

        const data = await res.json()
        const assistantMsg: Message = {
          id: generateId(),
          role: "assistant",
          content: data.response ?? "Sorry, I could not generate a response.",
        }

        setMessages((prev) => [...prev, assistantMsg])
      } catch (err: any) {
        const errMsg: Message = {
          id: generateId(),
          role: "assistant",
          content: `Sorry, something went wrong: ${err?.message ?? "Unknown error"}. Please try again.`,
        }
        setMessages((prev) => [...prev, errMsg])
      } finally {
        setLoading(false)
      }
    },
    [loading, accessToken]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputText)
    }
  }

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputText(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (initializing) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
        <div className="flex flex-col items-center gap-3">
          <Bot className="h-10 w-10 animate-pulse text-purple-500" />
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Loading your AI Coach…
          </p>
        </div>
      </div>
    )
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ── Header ── */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-cyan-500 shadow-lg">
              <Bot className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                Personal AI Coach
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Your data-driven fitness companion
              </p>
            </div>
          </div>
          <span className="hidden rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 px-3 py-1 text-xs font-semibold text-white shadow-sm sm:inline-flex">
            Powered by RAG + LLM
          </span>
        </div>

        {/* ── Two-column layout ── */}
        <div className="flex gap-4 lg:gap-6">
          {/* ── Left Sidebar (desktop only) ── */}
          <aside className="hidden w-64 shrink-0 flex-col gap-4 lg:flex">
            {/* Stats card */}
            <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-800/80">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Your Stats
              </h2>
              <ul className="space-y-3">
                <li className="flex items-center gap-2">
                  <Target className="h-4 w-4 shrink-0 text-purple-500" />
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Goal</p>
                    <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">
                      {userStats.goal ?? "—"}
                    </p>
                  </div>
                </li>
                <li className="flex items-center gap-2">
                  <Flame className="h-4 w-4 shrink-0 text-orange-500" />
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Current Streak
                    </p>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {userStats.streak} day{userStats.streak !== 1 ? "s" : ""}
                    </p>
                  </div>
                </li>
                <li className="flex items-center gap-2">
                  <Zap className="h-4 w-4 shrink-0 text-cyan-500" />
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Last Workout
                    </p>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {userStats.lastWorkout
                        ? formatDate(userStats.lastWorkout)
                        : "—"}
                    </p>
                  </div>
                </li>
                <li className="flex items-center gap-2">
                  <Scale className="h-4 w-4 shrink-0 text-emerald-500" />
                  <div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Current Weight
                    </p>
                    <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                      {userStats.weight ?? "—"}
                    </p>
                  </div>
                </li>
              </ul>
            </div>

            {/* Suggested questions */}
            <div className="rounded-2xl border border-slate-200/60 bg-white/80 p-4 shadow-sm backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-800/80">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Suggested Questions
              </h2>
              <ul className="space-y-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <li key={q}>
                    <button
                      onClick={() => sendMessage(q)}
                      disabled={loading}
                      className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 transition-colors hover:bg-purple-50 hover:text-purple-700 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-purple-900/20 dark:hover:text-purple-400"
                    >
                      <ChevronRight className="h-3 w-3 shrink-0 text-purple-400" />
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          {/* ── Main Chat Area ── */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-1 flex-col rounded-2xl border border-slate-200/60 bg-white/80 shadow-sm backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-800/80">
              {/* Messages list */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-5" style={{ minHeight: "calc(100vh - 340px)", maxHeight: "calc(100vh - 260px)" }}>
                {messages.length === 0 && !loading ? (
                  // Welcome state
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-cyan-500/20 shadow-inner dark:from-purple-500/30 dark:to-cyan-500/30">
                      <Bot className="h-8 w-8 text-purple-500" />
                    </div>
                    <h2 className="mb-1 text-lg font-semibold text-slate-800 dark:text-slate-200">
                      Ask me anything about your fitness journey
                    </h2>
                    <p className="mb-6 max-w-sm text-sm text-slate-500 dark:text-slate-400">
                      I have full access to your workouts, meals, sleep, weight,
                      and goals. Let's talk!
                    </p>
                    {/* Inline suggested pills */}
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGGESTED_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          onClick={() => sendMessage(q)}
                          disabled={loading}
                          className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 transition-colors hover:bg-purple-100 disabled:opacity-50 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400 dark:hover:bg-purple-900/40"
                        >
                          {q}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex items-end gap-2 ${
                          msg.role === "user"
                            ? "flex-row-reverse"
                            : "flex-row"
                        }`}
                      >
                        {/* Avatar (assistant only) */}
                        {msg.role === "assistant" && (
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 shadow-sm">
                            <Bot className="h-3.5 w-3.5 text-white" />
                          </div>
                        )}

                        {/* Bubble */}
                        <div
                          className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm ${
                            msg.role === "user"
                              ? "bg-gradient-to-br from-purple-600 to-purple-700 text-white"
                              : "bg-white text-slate-800 dark:bg-slate-700/80 dark:text-slate-100"
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">
                            {msg.content}
                          </p>
                          {msg.created_at && (
                            <p
                              className={`mt-1 text-right text-[10px] ${
                                msg.role === "user"
                                  ? "text-purple-200"
                                  : "text-slate-400 dark:text-slate-500"
                              }`}
                            >
                              {formatDate(msg.created_at)}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}

                    {/* Loading dots */}
                    {loading && (
                      <div className="flex items-end gap-2">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 shadow-sm">
                          <Bot className="h-3.5 w-3.5 text-white" />
                        </div>
                        <div className="flex items-center gap-1 rounded-2xl bg-white px-4 py-3 shadow-sm dark:bg-slate-700/80">
                          <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 [animation-delay:-0.3s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400 [animation-delay:-0.15s]" />
                          <span className="h-2 w-2 animate-bounce rounded-full bg-purple-400" />
                        </div>
                      </div>
                    )}

                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Input area */}
              <div className="border-t border-slate-200/60 p-3 dark:border-slate-700/60 sm:p-4">
                {/* Mobile suggested pills */}
                <div className="mb-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
                  {SUGGESTED_QUESTIONS.slice(0, 3).map((q) => (
                    <button
                      key={q}
                      onClick={() => sendMessage(q)}
                      disabled={loading}
                      className="shrink-0 rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-medium text-purple-700 disabled:opacity-50 dark:border-purple-800 dark:bg-purple-900/20 dark:text-purple-400"
                    >
                      {q}
                    </button>
                  ))}
                </div>

                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    value={inputText}
                    onChange={handleTextareaChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask your AI Coach anything…"
                    rows={1}
                    disabled={loading || !accessToken}
                    className="flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-700/50 dark:text-white dark:placeholder-slate-500 dark:focus:border-purple-500"
                    style={{ maxHeight: "160px", overflowY: "auto" }}
                  />
                  <button
                    onClick={() => sendMessage(inputText)}
                    disabled={loading || !inputText.trim() || !accessToken}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-purple-700 text-white shadow-sm transition-all hover:from-purple-500 hover:to-purple-600 disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Send message"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="mt-2 text-center text-[10px] text-slate-400 dark:text-slate-600">
                  Enter to send · Shift+Enter for new line
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
