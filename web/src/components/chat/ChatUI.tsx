"use client"

import { useEffect, useState } from "react"
import { supabase } from "../../lib/supabase/client"

type Message = {
  role: "user" | "assistant"
  content: string
}

export default function ChatUI({
  currentPlan,
  onPlanUpdate,
}: {
  currentPlan: string
  onPlanUpdate: (plan: string) => void
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 🔥 INIT SESSION
  useEffect(() => {
    const init = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) return

      // get latest session
      const { data: session } = await supabase
        .from("chat_sessions")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      let sessionIdLocal = session?.id

      if (!sessionIdLocal) {
        const { data: newSession } = await supabase
          .from("chat_sessions")
          .insert({ user_id: user.id })
          .select()
          .single()

        sessionIdLocal = newSession.id
      }

      setSessionId(sessionIdLocal)

      // load messages
      const { data: msgs } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("session_id", sessionIdLocal)
        .order("created_at", { ascending: true })

      if (msgs) {
        const formatted = msgs.map((m: any) => ({
          role: m.role,
          content: m.content,
        }))
        setMessages(formatted)
      }
    }

    init()
  }, [])

  // 🔥 STREAMING SEND MESSAGE
  const sendMessage = async () => {
    if (!input.trim() || !sessionId) return

    const userText = input
    setInput("")

    const userMsg: Message = {
      role: "user",
      content: userText,
    }

    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    // save user message
    await supabase.from("chat_messages").insert({
      session_id: sessionId,
      role: "user",
      content: userText,
    })

    // add empty AI message (for streaming)
    let aiMessage: Message = { role: "assistant", content: "" }
    setMessages((prev) => [...prev, aiMessage])

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: userText,
        currentPlan,
        sessionId,
      }),
    })

    if (!res.body) {
      setLoading(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()

    let fullText = ""

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value)
      fullText += chunk

      // update last message live
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = {
          role: "assistant",
          content: fullText,
        }
        return updated
      })
    }

    // save AI response
    await supabase.from("chat_messages").insert({
      session_id: sessionId,
      role: "assistant",
      content: fullText,
    })

    onPlanUpdate(fullText)
    setLoading(false)
  }

  return (
    <div className="bg-white rounded-2xl p-4 shadow border border-slate-200">
      {/* CHAT MESSAGES */}
      <div className="h-80 overflow-y-auto space-y-3 mb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`p-3 rounded-xl max-w-[80%] ${
              msg.role === "user"
                ? "bg-purple-600 text-white ml-auto"
                : "bg-slate-100 text-slate-900"
            }`}
          >
            {msg.content}
          </div>
        ))}

        {/* typing indicator */}
        {loading && (
          <p className="text-sm text-slate-400">AI is typing...</p>
        )}
      </div>

      {/* INPUT */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 border border-slate-200 bg-slate-50 text-slate-900 placeholder-slate-400 p-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
          placeholder="Modify your plan..."
          onKeyDown={(e) => {
            if (e.key === "Enter") sendMessage()
          }}
        />

        <button
          onClick={sendMessage}
          disabled={loading}
          className="bg-purple-600 text-white px-4 rounded-lg disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  )
}