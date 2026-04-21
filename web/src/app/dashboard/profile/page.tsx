"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"
import { Share2, Copy } from "lucide-react"

export default function ProfilePage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const [shareToken, setShareToken] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  const [email, setEmail] = useState("")
  const [fullName, setFullName] = useState("")
  const [age, setAge] = useState("")

  const [goal, setGoal] = useState("")
  const [activityLevel, setActivityLevel] = useState("")
  const [dietPreference, setDietPreference] = useState("")
  const [trainingStyle, setTrainingStyle] = useState("")

  const [height, setHeight] = useState("")
  const [weight, setWeight] = useState("")

  const [injuries, setInjuries] = useState("")
  const [dailyTimeAvailable, setDailyTimeAvailable] = useState("")
  const [sleepHours, setSleepHours] = useState("")
  const [restDaysPerWeek, setRestDaysPerWeek] = useState("")
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([])

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace("/login")
        return
      }

      setEmail(user.email || "")

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle()

      if (error) {
        setStatus(error.message)
      }

      if (data) {
        setFullName(data.full_name || "")
        setAge(data.age?.toString() || "")
        setHeight(data.height?.toString() || "")
        setWeight(data.weight?.toString() || "")
        setGoal(data.goal || "")
        setActivityLevel(data.activity_level || "")
        setDietPreference(data.diet_preference || "")
        setTrainingStyle(data.training_style || "")
        setInjuries(data.injuries || "")
        setDailyTimeAvailable(data.workout_time || "")
        setSleepHours(data.sleep_hours || "")
        setRestDaysPerWeek(data.days_off?.toString() || "")
        setDietaryRestrictions(Array.isArray(data.dietary_restrictions) ? data.dietary_restrictions : [])
      }

      setLoading(false)
    }

    load()
  }, [router])

  const completion = useMemo(() => {
    const fields = [
      fullName,
      age,
      height,
      weight,
      goal,
      activityLevel,
      dietPreference,
      trainingStyle,
      dailyTimeAvailable,
      sleepHours,
      restDaysPerWeek,
    ]
    const filled = fields.filter(Boolean).length
    return Math.round((filled / fields.length) * 100)
  }, [
    fullName,
    age,
    height,
    weight,
    goal,
    activityLevel,
    dietPreference,
    trainingStyle,
    dailyTimeAvailable,
    sleepHours,
    restDaysPerWeek,
  ])

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.replace("/login")
        return
      }

      const { error } = await supabase.from("profiles").upsert({
        id: user.id,
        full_name: fullName || null,
        age: age ? Number(age) : null,
        height: height || null,
        weight: weight || null,
        goal: goal || null,
        activity_level: activityLevel || null,
        diet_preference: dietPreference || null,
        training_style: trainingStyle || null,
        injuries: injuries || null,
        workout_time: dailyTimeAvailable || null,
        sleep_hours: sleepHours || null,
        days_off: restDaysPerWeek ? Number(restDaysPerWeek) : null,
        dietary_restrictions: dietaryRestrictions.length > 0 ? dietaryRestrictions : null,
      })

      if (error) {
        setStatus(error.message)
      } else {
        // Sync weight to weight_logs so charts stay accurate
        const weightNum = weight ? Number(weight) : null
        if (weightNum && Number.isFinite(weightNum) && weightNum > 0) {
          await supabase.from("weight_logs").upsert(
            { user_id: user.id, weight: weightNum, date: new Date().toISOString().split("T")[0] },
            { onConflict: "user_id,date" }
          )
        }
        setStatus("Profile updated successfully ✅")
      }
    } catch (err) {
      console.error(err)
      setStatus("Something went wrong while saving.")
    } finally {
      setSaving(false)
    }
  }

  const generateShareLink = async () => {
    setGenerating(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) {
        setStatus("You must be logged in to generate a share link.")
        return
      }

      const res = await fetch("/api/share", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      })

      if (!res.ok) {
        const err = await res.json()
        setStatus(err.error || "Failed to generate share link.")
        return
      }

      const { token } = await res.json()
      setShareToken(token)
    } catch (err) {
      console.error(err)
      setStatus("Something went wrong while generating the share link.")
    } finally {
      setGenerating(false)
    }
  }

  const shareUrl = shareToken
    ? (typeof window !== "undefined" ? window.location.origin : "") + "/shared/" + shareToken
    : ""

  const copyLink = async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setStatus("Failed to copy link. Please copy it manually.")
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace("/")
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-10">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="h-28 rounded-3xl bg-white dark:bg-slate-800 shadow-sm animate-pulse" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 h-[520px] rounded-3xl bg-white dark:bg-slate-800 shadow-sm animate-pulse" />
            <div className="h-[520px] rounded-3xl bg-white dark:bg-slate-800 shadow-sm animate-pulse" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-cyan-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-4 py-10 text-slate-900 dark:text-white">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/90 p-6 shadow-xl backdrop-blur">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-purple-600">Account Settings</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-tight">
                Profile Dashboard
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
                Update your fitness profile, preferences, and lifestyle details in one place.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                onClick={handleLogout}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-3 font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-50"
              >
                Logout
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-5 py-3 font-semibold text-white shadow-lg transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <StatCard label="Profile completion" value={`${completion}%`} />
            <StatCard label="Signed in as" value={email || "Unknown"} />
            <StatCard label="Status" value={status ? "Needs attention" : "Ready"} />
          </div>

          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-600 to-cyan-500 transition-all duration-300"
              style={{ width: `${completion}%` }}
            />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <SectionCard title="Personal Info" subtitle="Your basic identity details.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Full Name"
                  value={fullName}
                  onChange={setFullName}
                  placeholder="Enter your full name"
                />
                <Field
                  label="Age"
                  value={age}
                  onChange={setAge}
                  placeholder="e.g. 25"
                  type="number"
                />
                <Field
                  label="Height (cm)"
                  value={height}
                  onChange={setHeight}
                  placeholder="e.g. 175"
                  type="number"
                />
                <Field
                  label="Current Weight (kg)"
                  value={weight}
                  onChange={setWeight}
                  placeholder="e.g. 72"
                  type="number"
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Fitness Preferences"
              subtitle="This helps tailor your workouts and nutrition."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <SelectField
                  label="Goal"
                  value={goal}
                  onChange={setGoal}
                  options={[
                    "Weight Loss",
                    "Muscle Gain",
                    "General Fitness",
                    "Strength",
                    "Endurance",
                  ]}
                />
                <SelectField
                  label="Activity Level"
                  value={activityLevel}
                  onChange={setActivityLevel}
                  options={[
                    "Sedentary",
                    "Lightly Active",
                    "Moderately Active",
                    "Very Active",
                  ]}
                />
                <SelectField
                  label="Diet Preference"
                  value={dietPreference}
                  onChange={setDietPreference}
                  options={["Vegetarian", "Non-Vegetarian", "Vegan", "Eggetarian"]}
                />
                <SelectField
                  label="Training Style"
                  value={trainingStyle}
                  onChange={setTrainingStyle}
                  options={[
                    "Gym",
                    "Strength Training",
                    "Calisthenics",
                    "Home Workouts",
                    "Yoga",
                    "Running",
                  ]}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Lifestyle"
              subtitle="Recovery, sleep, and schedule details used in plan generation."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Injuries or limitations"
                  value={injuries}
                  onChange={setInjuries}
                  placeholder="Optional notes about pain, injuries, or limits"
                />
                <SelectField
                  label="Daily workout time"
                  value={dailyTimeAvailable}
                  onChange={setDailyTimeAvailable}
                  options={["15-30 mins", "30-45 mins", "45-60 mins", "60+ mins"]}
                />
                <SelectField
                  label="Sleep hours"
                  value={sleepHours}
                  onChange={setSleepHours}
                  options={[
                    "Less than 5",
                    "5-6 hours",
                    "6-7 hours",
                    "7-8 hours",
                    "8+ hours",
                  ]}
                />
                <SelectField
                  label="Rest days per week"
                  value={restDaysPerWeek}
                  onChange={setRestDaysPerWeek}
                  options={["0", "1", "2", "3", "4", "5", "6"]}
                />
              </div>

              <div className="mt-5">
                <label className="mb-3 block text-sm font-medium text-slate-700 dark:text-slate-300">
                  Dietary Restrictions
                </label>
                <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
                  Select all that apply — these will be respected in your meal plans.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    "Vegetarian",
                    "Vegan",
                    "Gluten-Free",
                    "Dairy-Free",
                    "Keto",
                    "Paleo",
                    "Halal",
                    "Kosher",
                    "Nut-Free",
                    "Low-Sodium",
                  ].map((option) => {
                    const selected = dietaryRestrictions.includes(option)
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() =>
                          setDietaryRestrictions((prev) =>
                            selected
                              ? prev.filter((r) => r !== option)
                              : [...prev, option]
                          )
                        }
                        className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all select-none ${
                          selected
                            ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow-md"
                            : "border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:border-purple-400"
                        }`}
                      >
                        {option}
                      </button>
                    )
                  })}
                </div>
              </div>
            </SectionCard>

            {status ? (
              <div
                className={`rounded-2xl border p-4 text-sm shadow-sm ${
                  status.includes("successfully")
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {status}
              </div>
            ) : null}
          </div>

          <div className="space-y-6">
            <SectionCard title="Profile Summary" subtitle="A quick snapshot of your setup.">
              <div className="space-y-3">
                <SummaryRow label="Name" value={fullName} />
                <SummaryRow label="Age" value={age ? `${age} yrs` : ""} />
                <SummaryRow label="Height" value={height ? `${height} cm` : ""} />
                <SummaryRow label="Weight" value={weight ? `${weight} kg` : ""} />
                <SummaryRow label="Goal" value={goal} />
                <SummaryRow label="Activity" value={activityLevel} />
                <SummaryRow label="Diet" value={dietPreference} />
                <SummaryRow label="Training" value={trainingStyle} />
                <SummaryRow label="Workout time" value={dailyTimeAvailable} />
                <SummaryRow label="Sleep" value={sleepHours} />
                <SummaryRow label="Rest days" value={restDaysPerWeek} />
                <SummaryRow
                  label="Restrictions"
                  value={dietaryRestrictions.length > 0 ? dietaryRestrictions.join(", ") : ""}
                />
              </div>
            </SectionCard>

            {/* Accountability Partner / Share Profile */}
            <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-4">
              <div className="mb-1">
                <h2 className="text-xl font-semibold">Accountability Partner</h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Share your progress with a friend to stay motivated.
                </p>
              </div>

              <button
                onClick={generateShareLink}
                disabled={generating}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-4 py-3 font-semibold text-white shadow-md transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Share2 className="h-4 w-4" />
                {generating ? "Generating..." : "Generate Link"}
              </button>

              {shareToken && shareUrl && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
                    Your share link
                  </p>
                  <div className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 px-3 py-2">
                    <code className="flex-1 truncate text-xs text-slate-700 dark:text-slate-300">
                      {shareUrl}
                    </code>
                    <button
                      onClick={copyLink}
                      title="Copy link"
                      className="flex-shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-purple-600"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                  {copied && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400">
                      Link copied to clipboard ✅
                    </p>
                  )}
                </div>
              )}
            </div>



          </div>
        </div>
      </div>
    </div>
  )
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
      {children}
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: string[]
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 px-4 py-3 text-slate-900 dark:text-white outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
      >
        <option value="">Select an option</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 px-4 py-3">
      <span className="text-sm text-slate-500 dark:text-slate-400">{label}</span>
      <span className="truncate text-sm font-semibold text-slate-900 dark:text-white">
        {value || "-"}
      </span>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
    </div>
  )
}