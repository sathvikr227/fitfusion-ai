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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white to-blue-50">
      <div className="w-full max-w-md p-8 rounded-2xl bg-white shadow-xl border border-gray-200">
        <div className="flex justify-center mb-6">
          <img src="/logo.png" className="w-14 h-14" alt="FitFusion AI" />
        </div>

        <h2 className="text-2xl font-semibold text-center mb-6 text-gray-900">
          Welcome Back
        </h2>

        <div className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-3 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />

          {error && <p className="text-red-500 text-sm">{error}</p>}

          <button
            onClick={handleLogin}
            className="w-full py-3 rounded-lg bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold"
          >
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </div>

        <p className="mt-4 text-sm text-center text-gray-500">
          Don’t have an account?{" "}
          <Link href="/signup" className="text-purple-600">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}