export default function AIPulse() {
  return (
    <div className="flex flex-col items-center justify-center space-y-8">
      <div className="relative">
        {/* Outer glowing rings */}
        <div className="absolute inset-0 rounded-full bg-purple-500 blur-xl opacity-20 animate-pulse" />
        <div className="relative h-24 w-24 rounded-full bg-gradient-to-tr from-purple-600 to-cyan-400 p-[2px] animate-spin-slow">
          <div className="h-full w-full rounded-full bg-white flex items-center justify-center">
            {/* Inner "Core" that breathes */}
            <div className="h-12 w-12 rounded-full bg-gradient-to-tr from-purple-600 to-cyan-400 animate-bounce-subtle" />
          </div>
        </div>
      </div>
      <div className="text-center">
        <h2 className="text-xl font-medium tracking-tight text-slate-900">Initializing FitFusion AI</h2>
        <p className="text-sm text-slate-500 mt-1">Syncing your metrics...</p>
      </div>
    </div>
  )
}