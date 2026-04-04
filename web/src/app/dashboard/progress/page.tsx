"use client"

import { useState } from "react"
import WeightTab from "./WeightTab"
import WorkoutTab from "./WorkoutTab"
import DietTab from "./DietTab"
import PhotosTab from "./PhotosTab"

export default function ProgressPage() {
  const [tab, setTab] = useState<"weight" | "workout" | "diet" | "photos">("weight")

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 px-4 py-6 md:px-10 md:py-10 text-slate-900">

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

            <p className="text-slate-500 mt-2 text-sm md:text-base max-w-xl">
              Track your workouts, diet, and body metrics over time. Stay consistent and monitor improvements.
            </p>
          </div>

          {/* OPTIONAL STATS CARD */}
          <div className="hidden md:flex gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3 shadow-sm">
              <p className="text-xs text-slate-400 uppercase">Streak</p>
              <p className="text-lg font-semibold">🔥 5 days</p>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-3 shadow-sm">
              <p className="text-xs text-slate-400 uppercase">Today</p>
              <p className="text-lg font-semibold">Active</p>
            </div>
          </div>
        </div>

        {/* 🔥 TAB SWITCHER (PRO UI) */}
        <div className="flex justify-center">
          <div className="flex gap-2 bg-white border border-slate-200 p-1 rounded-2xl shadow-sm">

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

          </div>
        </div>

        {/* 🔥 CONTENT CARD WRAPPER */}
        <div className="bg-white border border-slate-200 rounded-3xl shadow-sm p-4 md:p-6">

          {/* Smooth transition feel */}
          <div className="transition-all duration-300">

            {tab === "weight" && <WeightTab />}
            {tab === "workout" && <WorkoutTab />}
            {tab === "diet" && <DietTab />}
            {tab === "photos" && <PhotosTab />}

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
          : "text-slate-600 hover:bg-slate-100"}
      `}
    >
      {label}
    </button>
  )
}