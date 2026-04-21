"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"

type Props = {
  userId: string
}

type StarRatingProps = {
  value: number
  onChange: (v: number) => void
}

function StarRating({ value, onChange }: StarRatingProps) {
  const [hovered, setHovered] = useState(0)
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(star)}
          className="text-2xl transition-transform hover:scale-110 focus:outline-none"
          aria-label={`Rate ${star} star${star > 1 ? "s" : ""}`}
        >
          <span
            className={
              (hovered ? star <= hovered : star <= value)
                ? "text-amber-400"
                : "text-slate-300 dark:text-slate-600"
            }
          >
            ★
          </span>
        </button>
      ))}
    </div>
  )
}

function sevenDaysAgo() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return d.toISOString().split("T")[0]
}


export function WeeklyCheckIn({ userId }: Props) {
  const router = useRouter()

  const [isOpen, setIsOpen] = useState(false)
  const [weekRating, setWeekRating] = useState(0)
  const [energyLevel, setEnergyLevel] = useState<"Low" | "Moderate" | "High">("Moderate")
  const [notes, setNotes] = useState("")
  const [completionRate, setCompletionRate] = useState<number | null>(null)
  const [loadingRate, setLoadingRate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState("")

  // Fetch last 7 days completion rate from workout_execution
  useEffect(() => {
    if (!isOpen || !userId) return

    const fetchRate = async () => {
      setLoadingRate(true)
      const since = sevenDaysAgo()

      const { data } = await supabase
        .from("workout_execution")
        .select("exercise_name, done")
        .eq("user_id", userId)
        .gte("date", since)

      if (data && data.length > 0) {
        const doneCount = data.filter((r) => r.done).length
        setCompletionRate(Math.round((doneCount / data.length) * 100))
      } else {
        setCompletionRate(0)
      }
      setLoadingRate(false)
    }

    fetchRate()
  }, [isOpen, userId])

  const handleSubmit = async () => {
    if (weekRating === 0) {
      setErrorMsg("Please select a star rating before submitting.")
      return
    }

    setSubmitting(true)
    setErrorMsg(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token

      if (!token) {
        setErrorMsg("You must be logged in to submit your check-in.")
        return
      }

      const res = await fetch("/api/adaptive-replan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          weekRating,
          energyLevel,
          completionRate: completionRate ?? 0,
          notes,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data?.error || "Failed to update plan")
      }

      setSuccessMessage(data.message || "Your plan has been updated for next week!")
      setSuccess(true)
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    setIsOpen(false)
    setSuccess(false)
    setErrorMsg(null)
    setWeekRating(0)
    setEnergyLevel("Moderate")
    setNotes("")
    setCompletionRate(null)
  }

  const energyOptions: Array<"Low" | "Moderate" | "High"> = ["Low", "Moderate", "High"]

  const energyColors: Record<string, string> = {
    Low: "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/20 dark:text-rose-300",
    Moderate: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300",
    High: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300",
  }

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(true)}
        className="group flex w-full items-center gap-4 rounded-3xl border border-purple-200 dark:border-purple-900 bg-gradient-to-r from-purple-50 to-cyan-50 dark:from-purple-900/20 dark:to-cyan-900/20 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-600 to-cyan-500 text-white text-lg">
          📋
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900 dark:text-white">Weekly Check-In</p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Rate your week and let AI adapt your next plan
          </p>
        </div>
        <div className="shrink-0 text-purple-500 group-hover:translate-x-0.5 transition">›</div>
      </button>

      {/* Modal overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center"
          style={{ backgroundColor: "rgba(0,0,0,0.5)" }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleClose()
          }}
        >
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-6 shadow-2xl">
            {/* Modal header */}
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-slate-900 dark:text-white">
                  Weekly Check-In
                </h2>
                <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
                  How was this week? Help AI adapt your next week&apos;s plan.
                </p>
              </div>
              <button
                onClick={handleClose}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {success ? (
              /* Success state */
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20 p-6 text-center">
                  <span className="text-4xl">🎉</span>
                  <p className="font-bold text-emerald-800 dark:text-emerald-300">Plan Updated!</p>
                  <p className="text-sm text-emerald-700 dark:text-emerald-400">
                    {successMessage}
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={() => {
                      handleClose()
                      router.push("/dashboard/plan")
                    }}
                    className="flex-1 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 py-3 text-sm font-semibold text-white hover:opacity-90 transition"
                  >
                    View Updated Plan
                  </button>
                  <button
                    onClick={handleClose}
                    className="flex-1 rounded-2xl border border-slate-200 dark:border-slate-700 py-3 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              /* Form state */
              <div className="space-y-5">
                {/* Completion rate display */}
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2">
                    Your Completion Rate This Week
                  </p>
                  {loadingRate ? (
                    <p className="text-sm text-slate-500 dark:text-slate-400">Calculating...</p>
                  ) : completionRate !== null ? (
                    <div>
                      <div className="mb-2 flex items-baseline gap-2">
                        <span className="text-3xl font-bold text-slate-900 dark:text-white">
                          {completionRate}%
                        </span>
                        <span className="text-sm text-slate-500 dark:text-slate-400">
                          of exercises completed
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            completionRate >= 80
                              ? "bg-gradient-to-r from-emerald-400 to-cyan-400"
                              : completionRate >= 50
                              ? "bg-gradient-to-r from-amber-400 to-orange-400"
                              : "bg-gradient-to-r from-rose-400 to-pink-400"
                          }`}
                          style={{ width: `${completionRate}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      No workout execution data found for this week.
                    </p>
                  )}
                </div>

                {/* Star rating */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-900 dark:text-white">
                    How would you rate this week overall?
                  </label>
                  <StarRating value={weekRating} onChange={setWeekRating} />
                  {weekRating > 0 && (
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {weekRating === 1 && "Tough week — let's make it easier."}
                      {weekRating === 2 && "Below expectations — we'll dial it back a bit."}
                      {weekRating === 3 && "Solid week — keeping similar intensity."}
                      {weekRating === 4 && "Great week — slight progression ahead!"}
                      {weekRating === 5 && "Crushing it! Time to level up!"}
                    </p>
                  )}
                </div>

                {/* Energy level */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-900 dark:text-white">
                    How was your energy level?
                  </label>
                  <div className="flex gap-2">
                    {energyOptions.map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setEnergyLevel(level)}
                        className={`flex-1 rounded-2xl border px-3 py-2.5 text-sm font-medium transition ${
                          energyLevel === level
                            ? energyColors[level]
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800"
                        }`}
                      >
                        {level === "Low" && "😴 "}
                        {level === "Moderate" && "😊 "}
                        {level === "High" && "⚡ "}
                        {level}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-900 dark:text-white">
                    Any notes? <span className="font-normal text-slate-400">(optional)</span>
                  </label>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="e.g. knee felt sore, too many sets, want more cardio..."
                    rows={3}
                    className="w-full rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-sm text-slate-900 dark:text-white outline-none placeholder:text-slate-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-100 transition resize-none"
                  />
                </div>

                {/* Error */}
                {errorMsg && (
                  <div className="rounded-2xl border border-rose-200 bg-rose-50 dark:border-rose-800 dark:bg-rose-900/20 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
                    {errorMsg}
                  </div>
                )}

                {/* Submit */}
                <button
                  onClick={handleSubmit}
                  disabled={submitting || weekRating === 0}
                  className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 py-3.5 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {submitting ? "Updating your plan..." : "Submit & Update My Plan"}
                </button>

                <p className="text-center text-xs text-slate-400 dark:text-slate-500">
                  AI will analyze your week and intelligently adjust next week&apos;s plan.
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
