"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"
import Link from "next/link"

export default function LoginPage() {
  const router = useRouter()

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    setLoading(true)
    setError(null)

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        setError(error.message)
        return
      }

      const user = data.user

      if (!user) {
        setError("Unable to sign in.")
        return
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, onboarding_completed")
        .eq("id", user.id)
        .maybeSingle()

      if (profileError) {
        setError(profileError.message)
        return
      }

      if (!profile || !profile.onboarding_completed) {
        router.push("/onboarding")
        return
      }

      const { data: latestPlan, error: planError } = await supabase
        .from("workout_plans")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (planError) {
        setError(planError.message)
        return
      }

      if (latestPlan?.id) {
        router.push("/dashboard/home")
      } else {
        router.push("/generate")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white to-blue-50 dark:from-slate-950 dark:to-slate-900">
      <div className="w-full max-w-md p-8 rounded-3xl bg-white dark:bg-slate-800 shadow-xl border border-slate-200 dark:border-slate-700">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" className="w-14 h-14" alt="FitFusion AI" />
        </div>

        <h2 className="text-2xl font-semibold text-center mb-6 text-slate-900 dark:text-white">
          Welcome Back
        </h2>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleLogin}
            className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold hover:opacity-90 transition"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>

        <p className="mt-4 text-sm text-center text-slate-500">
          Don’t have an account?{" "}
          <Link href="/signup" className="text-purple-600 font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}