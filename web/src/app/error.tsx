"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  useEffect(() => {
    console.error("App error:", error)
  }, [error])

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-rose-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-rose-100 dark:bg-rose-900/30">
            <AlertTriangle className="h-10 w-10 text-rose-600 dark:text-rose-400" />
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Something went wrong</h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            An unexpected error occurred. Your data is safe — try refreshing or go back to the dashboard.
          </p>
          {error.digest && (
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-600 font-mono">
              Error ID: {error.digest}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            onClick={reset}
            className="flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition"
          >
            <RefreshCw className="h-4 w-4" />
            Try Again
          </button>
          <button
            onClick={() => router.push("/dashboard/home")}
            className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-6 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
          >
            <Home className="h-4 w-4" />
            Go Home
          </button>
        </div>
      </div>
    </div>
  )
}
