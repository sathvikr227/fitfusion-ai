"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"
import Link from "next/link"
import FitFusionLogo from "../../components/FitFusionLogo"
import { Eye, EyeOff, Mail, Lock, ArrowRight, Zap, BarChart2, Brain } from "lucide-react"

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
    <div className="min-h-screen flex bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">

      {/* ── Left brand panel ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-purple-600 via-violet-700 to-cyan-600 relative overflow-hidden flex-col items-center justify-center px-14">

        {/* Decorative blobs */}
        <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-cyan-400/20 rounded-full blur-3xl" />
        <div className="absolute top-1/3 left-1/2 w-48 h-48 bg-purple-300/10 rounded-full blur-2xl" />

        {/* Subtle grid */}
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        <div className="relative z-10 max-w-xs w-full space-y-10">

          {/* Logo + brand */}
          <div className="flex items-center gap-4">
            <div className="p-1 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20">
              <FitFusionLogo className="w-12 h-12" />
            </div>
            <div>
              <p className="text-white/60 text-xs font-semibold tracking-[0.25em] uppercase">Welcome to</p>
              <h1 className="text-2xl font-extrabold text-white tracking-tight leading-none">
                FitFusion <span className="text-cyan-200">AI</span>
              </h1>
            </div>
          </div>

          {/* Tagline */}
          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              Train smarter.<br />Live better.
            </h2>
            <p className="mt-3 text-white/70 text-sm leading-relaxed">
              AI-powered fitness coaching that adapts to your body, goals, and lifestyle — all in one place.
            </p>
          </div>

          {/* Feature list */}
          <ul className="space-y-4">
            {[
              { icon: Brain, label: "AI Coach with RAG", sub: "Answers grounded in your real data" },
              { icon: BarChart2, label: "Smart Analytics", sub: "Anomaly detection & predictions" },
              { icon: Zap, label: "Personalised Plans", sub: "Nutrition, workouts, habits & more" },
            ].map(({ icon: Icon, label, sub }) => (
              <li key={label} className="flex items-center gap-3">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-white" />
                </div>
                <div>
                  <p className="text-white text-sm font-semibold leading-none">{label}</p>
                  <p className="text-white/55 text-xs mt-0.5">{sub}</p>
                </div>
              </li>
            ))}
          </ul>

          {/* Stats row */}
          <div className="flex gap-6">
            {[["20+", "Features"], ["AI", "Powered"], ["RAG", "Engine"]].map(([val, lbl]) => (
              <div key={lbl}>
                <p className="text-white text-xl font-extrabold leading-none">{val}</p>
                <p className="text-white/50 text-xs mt-0.5">{lbl}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Right form panel ─────────────────────────────────────── */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="flex lg:hidden flex-col items-center mb-8 gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-600 to-cyan-500 rounded-2xl shadow-lg shadow-purple-500/30">
              <FitFusionLogo className="w-12 h-12" />
            </div>
            <h1 className="text-2xl font-extrabold text-slate-900 dark:text-white">
              FitFusion <span className="bg-gradient-to-r from-purple-600 to-cyan-500 bg-clip-text text-transparent">AI</span>
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
    </div>
  )
}
