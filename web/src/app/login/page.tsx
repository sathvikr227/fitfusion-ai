"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"
import Link from "next/link"
import FitFusionLogo from "../../components/FitFusionLogo"
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react"

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) { setError(error.message); return }
      const user = data.user
      if (!user) { setError("Unable to sign in."); return }

      const { data: profile, error: profileError } = await supabase
        .from("profiles").select("id, onboarding_completed").eq("id", user.id).maybeSingle()
      if (profileError) { setError(profileError.message); return }
      if (!profile || !profile.onboarding_completed) { router.push("/onboarding"); return }

      const { data: latestPlan } = await supabase
        .from("workout_plans").select("id").eq("user_id", user.id)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()
      router.push(latestPlan?.id ? "/dashboard/home" : "/generate")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 px-6 py-12">
      <div className="w-full max-w-md">

        {/* Logo + brand */}
        <div className="flex flex-col items-center mb-8 gap-3">
          <div className="p-2 bg-gradient-to-br from-purple-600 to-cyan-500 rounded-2xl shadow-lg shadow-purple-500/30">
            <FitFusionLogo className="w-14 h-14" />
          </div>
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            FitFusion
          </h1>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/60 dark:shadow-slate-950/60 p-8">

          <div className="mb-7">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Welcome back</h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Sign in to continue your journey</p>
          </div>

          <div className="space-y-4">

            {/* Email */}
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400 transition"
              />
            </div>

            {/* Password */}
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="w-full pl-11 pr-12 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400 transition"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="px-4 py-3 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Button */}
            <button
              onClick={handleLogin}
              disabled={loading}
              className="group w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 hover:opacity-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Signing in...
                </>
              ) : (
                <>
                  Sign In
                  <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </>
              )}
            </button>
          </div>

          <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-purple-600 dark:text-purple-400 font-semibold hover:text-purple-700 transition">
              Create one free
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
