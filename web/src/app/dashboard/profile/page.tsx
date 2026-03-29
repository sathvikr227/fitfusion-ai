"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../../lib/supabase/client"

export default function ProfilePage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const [fullName, setFullName] = useState("")
  const [age, setAge] = useState("")
  const [weight, setWeight] = useState("")
  const [goal, setGoal] = useState("")
  const [activityLevel, setActivityLevel] = useState("")
  const [dietPreference, setDietPreference] = useState("")
  const [trainingStyle, setTrainingStyle] = useState("")

  useEffect(() => {
    const load = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!user) {
        router.push("/auth/login")
        return
      }

      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle()

      if (data) {
        setFullName(data.full_name || "")
        setAge(data.age?.toString() || "")
        setWeight(data.weight?.toString() || "")
        setGoal(data.goal || "")
        setActivityLevel(data.activity_level || "")
        setDietPreference(data.diet_preference || "")
        setTrainingStyle(data.training_style || "")
      }

      setLoading(false)
    }

    load()
  }, [router])

  const handleSave = async () => {
    setSaving(true)
    setStatus(null)

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) return

    const { error } = await supabase.from("profiles").upsert({
      id: user.id,
      full_name: fullName || null,
      age: age ? Number(age) : null,
      weight: weight ? Number(weight) : null,
      goal,
      activity_level: activityLevel,
      diet_preference: dietPreference,
      training_style: trainingStyle,
    })

    if (error) {
      setStatus(error.message)
    } else {
      setStatus("Profile updated successfully")
    }

    setSaving(false)
  }

  if (loading) {
    return <div className="p-6 text-slate-900">Loading...</div>
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 text-slate-900">

      <h1 className="text-3xl font-semibold">Profile Settings</h1>

      <div className="grid gap-4 md:grid-cols-2">

        <input placeholder="Full Name" value={fullName} onChange={(e)=>setFullName(e.target.value)} className="input"/>
        <input type="number" placeholder="Age" value={age} onChange={(e)=>setAge(e.target.value)} className="input"/>
        <input type="number" placeholder="Weight" value={weight} onChange={(e)=>setWeight(e.target.value)} className="input"/>

        <select value={goal} onChange={(e)=>setGoal(e.target.value)} className="input">
          <option value="">Goal</option>
          <option>Weight Loss</option>
          <option>Muscle Gain</option>
        </select>

        <select value={activityLevel} onChange={(e)=>setActivityLevel(e.target.value)} className="input">
          <option value="">Activity Level</option>
          <option>Sedentary</option>
          <option>Active</option>
        </select>

        <select value={dietPreference} onChange={(e)=>setDietPreference(e.target.value)} className="input">
          <option value="">Diet</option>
          <option>Vegetarian</option>
          <option>Non-Veg</option>
        </select>

        <select value={trainingStyle} onChange={(e)=>setTrainingStyle(e.target.value)} className="input md:col-span-2">
          <option value="">Training Style</option>
          <option>Gym</option>
          <option>Home</option>
        </select>
      </div>

      {status && <p className="text-sm">{status}</p>}

      <button
        onClick={handleSave}
        className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white"
      >
        {saving ? "Saving..." : "Save Changes"}
      </button>

    </div>
  )
}