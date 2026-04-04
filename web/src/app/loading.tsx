export default function GlobalLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-purple-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative h-12 w-12">
          <div className="absolute inset-0 rounded-full border-2 border-purple-200 dark:border-purple-900" />
          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-600 animate-spin" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">Loading FitFusion…</p>
      </div>
    </div>
  )
}
