"use client"

import Link from "next/link"
import { Home, SearchX } from "lucide-react"

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        <div className="flex justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-purple-100 dark:bg-purple-900/30">
            <SearchX className="h-10 w-10 text-purple-600 dark:text-purple-400" />
          </div>
        </div>

        <div>
          <p className="text-7xl font-extrabold text-slate-200 dark:text-slate-800">404</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-white">Page not found</h1>
          <p className="mt-2 text-slate-500 dark:text-slate-400">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>
        </div>

        <Link
          href="/dashboard/home"
          className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-3 text-sm font-semibold text-white hover:opacity-90 transition"
        >
          <Home className="h-4 w-4" />
          Back to Dashboard
        </Link>
      </div>
    </div>
  )
}
