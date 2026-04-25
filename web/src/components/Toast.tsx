"use client"

import { create } from "zustand"
import { useEffect, useState } from "react"
import { CheckCircle2, AlertCircle, Info, X } from "lucide-react"

type ToastVariant = "success" | "error" | "info"

type ToastItem = {
  id: number
  message: string
  variant: ToastVariant
}

type ToastStore = {
  toasts: ToastItem[]
  show: (message: string, variant?: ToastVariant) => void
  dismiss: (id: number) => void
}

const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  show: (message, variant = "info") => {
    const id = Date.now() + Math.random()
    set((s) => ({ toasts: [...s.toasts, { id, message, variant }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (msg: string) => useToastStore.getState().show(msg, "success"),
  error: (msg: string) => useToastStore.getState().show(msg, "error"),
  info: (msg: string) => useToastStore.getState().show(msg, "info"),
}

const variantStyles: Record<ToastVariant, string> = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100",
  error:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-100",
  info:
    "border-slate-200 bg-white text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100",
}

const variantIcons: Record<ToastVariant, React.ReactNode> = {
  success: <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
  error: <AlertCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />,
  info: <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />,
}

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex min-w-[260px] max-w-sm items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg transition-all ${variantStyles[t.variant]}`}
          role="status"
        >
          <div className="mt-0.5 shrink-0">{variantIcons[t.variant]}</div>
          <div className="flex-1 text-sm font-medium leading-snug">{t.message}</div>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded-full p-1 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
