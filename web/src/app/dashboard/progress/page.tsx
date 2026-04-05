"use client"

import { useState, useEffect } from "react"
import { supabase } from "../../../lib/supabase/client"
import WeightTab from "./WeightTab"
import WorkoutTab from "./WorkoutTab"
import DietTab from "./DietTab"
import PhotosTab from "./PhotosTab"
import SleepTab from "./SleepTab"
import StrengthTab from "./StrengthTab"

function calcStreak(dates: string[]): number {
  const unique = Array.from(
    new Set(dates.map((d) => new Date(d).toISOString().split("T")[0]))
  ).sort().reverse()
  if (unique.length === 0) return 0
  const today = new Date().toISOString().split("T")[0]
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
  const yStr = yesterday.toISOString().split("T")[0]
  if (unique[0] !== today && unique[0] !== yStr) return 0
  let streak = 1
  for (let i = 1; i < unique.length; i++) {
    const diff = Math.round((new Date(unique[i - 1]).getTime() - new Date(unique[i]).getTime()) / 86400000)
    if (diff === 1) streak++
    else break
  }
  return streak
}

export default function ProgressPage() {
  const [tab, setTab] = useState<"weight" | "workout" | "diet" | "photos" | "sleep" | "strength">("weight")
  const [streak, setStreak] = useState<number | null>(null)
  const [todayActive, setTodayActive] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const today = new Date().toISOString().split("T")[0]
      const { data } = await supabase
        .from("workout_logs")
        .select("date, created_at")
        .eq("user_id", user.id)
        .order("date", { ascending: false })
        .limit(60)
      if (!data) return
      const dates = data.map((r: any) => r.date ?? r.created_at)
      setStreak(calcStreak(dates))
      setTodayActive(dates.some((d: string) => (d ?? "").startsWith(today)))
    }
    load()
  }, [])

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-6 md:px-10 md:py-10 text-slate-900 dark:text-white">

      {/* MAIN CONTAINER */}
      <div className="max-w-7xl mx-auto space-y-8">

        {/* 🔥 HEADER */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-purple-600 font-medium">
              FitFusion AI
            </p>

            <h1 className="text-3xl md:text-5xl font-semibold mt-2">
              Progress Tracking
            </h1>

            <p className="text-slate-500 dark:text-slate-400 mt-2 text-sm md:text-base max-w-xl">
              Track your workouts, diet, and body metrics over time. Stay consistent and monitor improvements.
            </p>
          </div>

          {/* OPTIONAL STATS CARD */}
          <div className="hidden md:flex gap-4">
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3 shadow-sm">
              <p className="text-xs text-slate-400 uppercase">Streak</p>
              <p className="text-lg font-semibold">
                {streak === null ? "—" : streak > 0 ? `🔥 ${streak} day${streak !== 1 ? "s" : ""}` : "0 days"}
              </p>
            </div>

            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-5 py-3 shadow-sm">
              <p className="text-xs text-slate-400 uppercase">Today</p>
              <p className="text-lg font-semibold">{todayActive ? "Active ✅" : "Rest"}</p>
            </div>
          </div>
        </div>

        {/* 🔥 TAB SWITCHER (PRO UI) */}
        <div className="flex justify-center">
          <div className="flex gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-1 rounded-2xl shadow-sm">

            <TabButton
              label="Weight"
              active={tab === "weight"}
              onClick={() => setTab("weight")}
            />

            <TabButton
              label="Workout"
              active={tab === "workout"}
              onClick={() => setTab("workout")}
            />

            <TabButton
              label="Diet"
              active={tab === "diet"}
              onClick={() => setTab("diet")}
            />

            <TabButton
              label="Photos"
              active={tab === "photos"}
              onClick={() => setTab("photos")}
            />

            <TabButton
              label="Sleep"
              active={tab === "sleep"}
              onClick={() => setTab("sleep")}
            />

            <TabButton
              label="Strength"
              active={tab === "strength"}
              onClick={() => setTab("strength")}
            />

          </div>
        </div>

        {/* 🔥 CONTENT CARD WRAPPER */}
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-3xl shadow-sm p-4 md:p-6">

          {/* Smooth transition feel */}
          <div className="transition-all duration-300">

            {tab === "weight" && <WeightTab />}
            {tab === "workout" && <WorkoutTab />}
            {tab === "diet" && <DietTab />}
            {tab === "photos" && <PhotosTab />}
            {tab === "sleep" && <SleepTab />}
            {tab === "strength" && <StrengthTab />}

          </div>
        </div>

      </div>
    </div>
  )
}

/* 🔥 REUSABLE TAB BUTTON (PRO LEVEL) */
function TabButton({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`
        px-6 py-2 rounded-xl text-sm font-medium transition-all
        ${active
          ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow"
          : "text-slate-600 dark:text-slate-400 hover:bg-slate-100"}
      `}
    >
      {label}
    </button>
  )
}