"use client"
import { useState, useEffect } from "react"
import { supabase } from "../../../lib/supabase/client"
import { Smile } from "lucide-react"

const MOODS = [
  { emoji: "😴", label: "Tired", value: 1 },
  { emoji: "😕", label: "Meh", value: 2 },
  { emoji: "😊", label: "Good", value: 3 },
  { emoji: "💪", label: "Strong", value: 4 },
  { emoji: "🔥", label: "Fired Up", value: 5 },
]

export function MoodCheckIn({ userId }: { userId: string }) {
  const [selected, setSelected] = useState<number | null>(null)
  const [saved, setSaved] = useState(false)
  const [alreadyLogged, setAlreadyLogged] = useState(false)

  const today = new Date().toISOString().split("T")[0]

  useEffect(() => {
    // Check if mood already logged today
    supabase
      .from("mood_logs")
      .select("mood")
      .eq("user_id", userId)
      .eq("date", today)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.mood) {
          setSelected(data.mood)
          setAlreadyLogged(true)
        }
      })
  }, [userId, today])

  const handleSelect = async (value: number) => {
    if (alreadyLogged) return
    setSelected(value)
    setSaved(false)
    const { error } = await supabase
      .from("mood_logs")
      .upsert({ user_id: userId, date: today, mood: value }, { onConflict: "user_id,date" })
    if (!error) {
      setSaved(true)
      setAlreadyLogged(true)
    }
  }

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-50 dark:bg-amber-900/30">
          <Smile className="h-4 w-4 text-amber-500" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-900 dark:text-white">
            {alreadyLogged ? "Today's Mood" : "How are you feeling today?"}
          </p>
          {alreadyLogged && (
            <p className="text-xs text-slate-400">Mood logged for today</p>
          )}
        </div>
      </div>
      <div className="flex gap-2 justify-between">
        {MOODS.map(({ emoji, label, value }) => (
          <button
            key={value}
            onClick={() => handleSelect(value)}
            disabled={alreadyLogged && selected !== value}
            className={`flex flex-1 flex-col items-center gap-1 rounded-2xl border py-2.5 text-xs font-medium transition-all ${
              selected === value
                ? "border-amber-400 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 scale-105"
                : "border-slate-100 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 disabled:opacity-40"
            }`}
          >
            <span className="text-xl">{emoji}</span>
            <span className="hidden sm:block">{label}</span>
          </button>
        ))}
      </div>
      {saved && (
        <p className="mt-3 text-center text-xs text-emerald-600 dark:text-emerald-400 font-medium">
          ✓ Mood saved!
        </p>
      )}
    </div>
  )
}
