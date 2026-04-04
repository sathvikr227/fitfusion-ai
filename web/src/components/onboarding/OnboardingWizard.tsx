"use client"

import { useMemo, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"

type FormData = {
  age: string
  gender: string
  height: string
  weight: string
  goal: string
  activityLevel: string
  dietPreference: string
  trainingStyle: string
  injuries: string
  dailyTimeAvailable: string
  sleepHours: string
  restDaysPerWeek: string
}

const initialData: FormData = {
  age: "",
  gender: "",
  height: "",
  weight: "",
  goal: "",
  activityLevel: "",
  dietPreference: "",
  trainingStyle: "",
  injuries: "",
  dailyTimeAvailable: "",
  sleepHours: "",
  restDaysPerWeek: "",
}

export default function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [formData, setFormData] = useState<FormData>(initialData)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const totalSteps = 6

  const progress = useMemo(() => {
    return `${(step / totalSteps) * 100}%`
  }, [step])

  const updateField = (field: keyof FormData, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }))
    setError("")
  }

  const validateStep = () => {
    if (step === 1) {
      if (!formData.age || !formData.gender) {
        setError("Please fill age and gender.")
        return false
      }
    }

    if (step === 2) {
      if (!formData.height || !formData.weight) {
        setError("Please fill height and weight.")
        return false
      }
    }

    if (step === 3) {
      if (!formData.goal || !formData.activityLevel) {
        setError("Please select your goal and activity level.")
        return false
      }
    }

    if (step === 4) {
      if (!formData.dietPreference) {
        setError("Please select a diet preference.")
        return false
      }
    }

    if (step === 5) {
      if (!formData.trainingStyle) {
        setError("Please select a training style.")
        return false
      }
    }

    if (step === 6) {
      if (!formData.dailyTimeAvailable) {
        setError("Please select your daily workout time.")
        return false
      }

      if (!formData.sleepHours) {
        setError("Please select your sleep hours.")
        return false
      }

      if (!formData.restDaysPerWeek) {
        setError("Please select how many days per week you will rest.")
        return false
      }
    }

    return true
  }

  const handleNext = () => {
    if (!validateStep()) return
    if (step < totalSteps) setStep((prev) => prev + 1)
  }

  const handleBack = () => {
    if (step > 1) setStep((prev) => prev - 1)
  }

  const handleContinue = async () => {
    if (!validateStep()) return

    setSaving(true)
    setError("")

    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()

      if (userError) {
        console.error("Failed to get user:", userError)
        setError("Unable to confirm your account. Try logging in again.")
        setSaving(false)
        return
      }

      const user = userData?.user
      if (!user) {
        setError("No authenticated user found.")
        setSaving(false)
        return
      }

      const profilePayload = {
        id: user.id,
        full_name: (user.user_metadata as any)?.full_name || "",
        age: formData.age ? Number(formData.age) : null,
        gender: formData.gender || null,
        height: formData.height ? Number(formData.height) : null,
        weight: formData.weight ? Number(formData.weight) : null,
        goal: formData.goal || null,
        activity_level: formData.activityLevel || null,
        diet_preference: formData.dietPreference || null,
        training_style: formData.trainingStyle || null,
        injuries: formData.injuries || null,
        daily_time_available: formData.dailyTimeAvailable || null,
        sleep_hours: formData.sleepHours || null,
        rest_days_per_week: formData.restDaysPerWeek
          ? Number(formData.restDaysPerWeek)
          : null,
        onboarding_completed: true,
      }

      const { error: upsertError } = await supabase.from("profiles").upsert(profilePayload)

      if (upsertError) {
        console.error("Failed to save profile:", upsertError)
        setError("Failed to save profile. Please try again.")
        setSaving(false)
        return
      }

      const { data: existingLog, error: logCheckError } = await supabase
        .from("progress_logs")
        .select("id")
        .eq("user_id", user.id)
        .eq("log_type", "onboarding")
        .limit(1)

      if (logCheckError) {
        console.error("Failed to check onboarding log:", logCheckError)
      }

      if (!existingLog || existingLog.length === 0) {
        const { error: logInsertError } = await supabase.from("progress_logs").insert({
          user_id: user.id,
          weight: formData.weight ? Number(formData.weight) : null,
          completed: false,
          calories_burned: 0,
          calories_consumed: 0,
          log_type: "onboarding",
        })

        if (logInsertError) {
          console.error("Failed to insert onboarding progress log:", logInsertError)
        }
      }

      router.push("/generate?from=onboarding")
    } catch (err) {
      console.error("Unexpected error saving profile", err)
      setError("Unexpected error. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/90 shadow-2xl backdrop-blur-sm">
        <div className="border-b border-slate-100 px-8 pb-6 pt-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-purple-600">FitFusion AI Setup</p>
              <h1 className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">
                Personalize your fitness experience
              </h1>
              <p className="mt-2 text-sm text-slate-500">
                We’ll use this to generate your workout and nutrition plan.
              </p>
            </div>

            <div className="hidden h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-lg font-bold text-white shadow-lg sm:flex">
              {step}
            </div>
          </div>

          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-600 to-cyan-500 transition-all duration-300"
              style={{ width: progress }}
            />
          </div>
        </div>

        <div className="px-8 py-8">
          {step === 1 && (
            <StepCard title="Basic profile" subtitle="Let’s start with your age and gender.">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Age"
                  placeholder="Enter your age"
                  value={formData.age}
                  onChange={(value) => updateField("age", value)}
                  type="number"
                />

                <Select
                  label="Gender"
                  value={formData.gender}
                  onChange={(value) => updateField("gender", value)}
                  options={["Male", "Female", "Other"]}
                />
              </div>
            </StepCard>
          )}

          {step === 2 && (
            <StepCard
              title="Body metrics"
              subtitle="These help us estimate calorie needs and training intensity."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Height (cm)"
                  placeholder="e.g. 175"
                  value={formData.height}
                  onChange={(value) => updateField("height", value)}
                  type="number"
                />

                <Input
                  label="Weight (kg)"
                  placeholder="e.g. 72"
                  value={formData.weight}
                  onChange={(value) => updateField("weight", value)}
                  type="number"
                />
              </div>
            </StepCard>
          )}

          {step === 3 && (
            <StepCard
              title="Goal and activity"
              subtitle="We tailor the plan to your current lifestyle and target."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  label="Primary Goal"
                  value={formData.goal}
                  onChange={(value) => updateField("goal", value)}
                  options={[
                    "Weight Loss",
                    "Muscle Gain",
                    "General Fitness",
                    "Strength",
                    "Endurance",
                  ]}
                />

                <Select
                  label="Activity Level"
                  value={formData.activityLevel}
                  onChange={(value) => updateField("activityLevel", value)}
                  options={[
                    "Sedentary",
                    "Lightly Active",
                    "Moderately Active",
                    "Very Active",
                  ]}
                />
              </div>
            </StepCard>
          )}

          {step === 4 && (
            <StepCard
              title="Diet preference"
              subtitle="This helps us generate meal plans you’ll actually follow."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  label="Diet Preference"
                  value={formData.dietPreference}
                  onChange={(value) => updateField("dietPreference", value)}
                  options={["Vegetarian", "Non-Vegetarian", "Vegan", "Eggetarian"]}
                />
              </div>
            </StepCard>
          )}

          {step === 5 && (
            <StepCard
              title="Training style"
              subtitle="Pick the type of movement you enjoy most."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  label="Preferred Training"
                  value={formData.trainingStyle}
                  onChange={(value) => updateField("trainingStyle", value)}
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
            </StepCard>
          )}

          {step === 6 && (
            <StepCard
              title="Lifestyle extras"
              subtitle="These final details help the AI build a smarter weekly plan."
            >
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Input
                  label="Injuries or limitations"
                  placeholder="e.g. Knee pain, shoulder issue (optional)"
                  value={formData.injuries}
                  onChange={(value) => updateField("injuries", value)}
                />

                <Select
                  label="Daily workout time"
                  value={formData.dailyTimeAvailable}
                  onChange={(value) => updateField("dailyTimeAvailable", value)}
                  options={["15-30 mins", "30-45 mins", "45-60 mins", "60+ mins"]}
                />

                <Select
                  label="Sleep hours"
                  value={formData.sleepHours}
                  onChange={(value) => updateField("sleepHours", value)}
                  options={[
                    "Less than 5",
                    "5-6 hours",
                    "6-7 hours",
                    "7-8 hours",
                    "8+ hours",
                  ]}
                />

                <Select
                  label="Days off per week"
                  value={formData.restDaysPerWeek}
                  onChange={(value) => updateField("restDaysPerWeek", value)}
                  options={["0", "1", "2", "3", "4", "5", "6"]}
                />
              </div>

              <div className="mt-8">
                <h3 className="mb-4 text-lg font-semibold text-slate-900 dark:text-white">
                  Review your profile
                </h3>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <SummaryItem label="Age" value={formData.age} />
                  <SummaryItem label="Gender" value={formData.gender} />
                  <SummaryItem
                    label="Height"
                    value={formData.height ? `${formData.height} cm` : ""}
                  />
                  <SummaryItem
                    label="Weight"
                    value={formData.weight ? `${formData.weight} kg` : ""}
                  />
                  <SummaryItem label="Goal" value={formData.goal} />
                  <SummaryItem label="Activity Level" value={formData.activityLevel} />
                  <SummaryItem label="Diet Preference" value={formData.dietPreference} />
                  <SummaryItem label="Training Style" value={formData.trainingStyle} />
                  <SummaryItem label="Workout Time" value={formData.dailyTimeAvailable} />
                  <SummaryItem label="Sleep Hours" value={formData.sleepHours} />
                  <SummaryItem label="Days Off" value={formData.restDaysPerWeek} />
                  <SummaryItem label="Injuries" value={formData.injuries} />
                </div>
              </div>
            </StepCard>
          )}

          {error ? <p className="mt-6 text-sm font-medium text-red-500">{error}</p> : null}

          <div className="mt-8 flex items-center justify-between gap-4">
            <button
              onClick={handleBack}
              disabled={step === 1 || saving}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-5 py-3 font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-50 dark:hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Back
            </button>

            {step < totalSteps ? (
              <button
                onClick={handleNext}
                disabled={saving}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:opacity-95"
              >
                Continue
              </button>
            ) : (
              <button
                onClick={handleContinue}
                disabled={saving}
                className="rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-3 font-semibold text-white shadow-lg transition hover:opacity-95"
              >
                {saving ? "Saving..." : "Continue to Dashboard"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StepCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div>
      <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">{title}</h2>
      <p className="mb-6 mt-2 text-slate-500">{subtitle}</p>
      {children}
    </div>
  )
}

function Input({
  label,
  placeholder,
  value,
  onChange,
  type = "text",
}: {
  label: string
  placeholder: string
  value: string
  onChange: (value: string) => void
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
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
    </div>
  )
}

function Select({
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
        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-3 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
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

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-base font-semibold text-slate-900 dark:text-white">
        {value || "-"}
      </p>
    </div>
  )
}