"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { supabase } from "../../lib/supabase/client"
import Link from "next/link"
import FitFusionLogo from "../../components/FitFusionLogo"
import { Eye, EyeOff, Mail, Lock, User, ArrowRight, CheckCircle2 } from "lucide-react"

const PERKS = [
  "AI-generated personalised workout plans",
  "Smart nutrition tracking & meal logging",
  "Pose tracker with real-time feedback",
  "RAG-powered personal AI coach",
  "Anomaly detection & progress analytics",
  "Injury risk predictor & habit streaks",
]

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSignup = async () => {
    if (loading) return
    setError(null)
    if (password !== confirm) { setError("Passwords do not match"); return }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name } },
      })
      if (error) { setError(error.message); return }
      router.push("/onboarding")
    } finally {
      setLoading(false)
    }
  }

  const passwordMatch = confirm.length > 0 && password === confirm

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-white via-slate-50 to-blue-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">

      {/* ── Left brand panel ─────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[45%] bg-gradient-to-br from-purple-600 via-violet-700 to-cyan-600 relative overflow-hidden flex-col items-center justify-center px-14">

        <div className="absolute -top-20 -right-20 w-64 h-64 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-20 -left-20 w-72 h-72 bg-cyan-400/20 rounded-full blur-3xl" />
        <div className="absolute inset-0 opacity-10"
          style={{ backgroundImage: "linear-gradient(white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)", backgroundSize: "40px 40px" }} />

        <div className="relative z-10 max-w-xs w-full space-y-10">

          <div className="flex items-center gap-4">
            <div className="p-1 bg-white/10 rounded-2xl backdrop-blur-sm border border-white/20">
              <FitFusionLogo className="w-12 h-12" />
            </div>
            <div>
              <p className="text-white/60 text-xs font-semibold tracking-[0.25em] uppercase">Join</p>
              <h1 className="text-2xl font-extrabold text-white tracking-tight leading-none">
                FitFusion <span className="text-cyan-200">AI</span>
              </h1>
            </div>
          </div>

          <div>
            <h2 className="text-4xl font-bold text-white leading-tight">
              Your fitness<br />revolution<br />
              <span className="text-cyan-200">starts here.</span>
            </h2>
            <p className="mt-3 text-white/70 text-sm leading-relaxed">
              Everything you need to transform your health — powered by cutting-edge AI.
            </p>
          </div>

          <ul className="space-y-3">
            {PERKS.map((perk) => (
              <li key={perk} className="flex items-start gap-3">
                <CheckCircle2 className="w-4 h-4 text-cyan-300 mt-0.5 flex-shrink-0" />
                <span className="text-white/80 text-sm">{perk}</span>
              </li>
            ))}
          </ul>

          <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 rounded-2xl px-4 py-2.5">
            <span className="text-white text-xs font-medium">100% Free to get started</span>
            <span className="text-cyan-200 text-lg">✦</span>
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
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Create account</h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Free forever. No credit card needed.</p>
            </div>

            <div className="space-y-4">

              {/* Name */}
              <div className="relative">
                <User className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Full name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400 transition"
                />
              </div>

              {/* Email */}
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="email"
                  placeholder="Email address"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400 transition"
                />
              </div>

              {/* Password */}
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type={showPassword ? "text" : "password"}
                  placeholder="Password (min. 8 characters)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-12 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-400 transition"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Confirm password */}
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type={showConfirm ? "text" : "password"}
                  placeholder="Confirm password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSignup()}
                  className={`w-full pl-11 pr-12 py-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800 border text-slate-900 dark:text-white placeholder-slate-400 text-sm focus:outline-none focus:ring-2 transition ${
                    confirm.length > 0
                      ? passwordMatch
                        ? "border-emerald-400 focus:ring-emerald-500/30"
                        : "border-red-400 focus:ring-red-500/30"
                      : "border-slate-200 dark:border-slate-700 focus:ring-purple-500/50 focus:border-purple-400"
                  }`}
                />
                <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
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
                onClick={handleSignup}
                disabled={loading}
                className="group w-full py-3.5 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 text-white font-semibold text-sm shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 hover:opacity-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating account...
                  </>
                ) : (
                  <>
                    Create Account
                    <ArrowRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                  </>
                )}
              </button>
            </div>

            <p className="mt-6 text-center text-sm text-slate-500 dark:text-slate-400">
              Already have an account?{" "}
              <Link href="/login" className="text-purple-600 dark:text-purple-400 font-semibold hover:text-purple-700 transition">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
