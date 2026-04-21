import FitFusionLogo from "../FitFusionLogo"

export default function AIPulse() {
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative h-56 w-56 flex items-center justify-center">
        {/* Outer glow */}
        <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/30 via-fuchsia-500/20 to-cyan-400/30 rounded-full blur-3xl animate-pulse" />

        {/* Rotating rings */}
        <div className="absolute inset-2 border border-purple-400/30 rounded-full animate-[spin_12s_linear_infinite]">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 bg-purple-400 rounded-full shadow-[0_0_12px_#a855f7]" />
        </div>
        <div className="absolute inset-6 border border-cyan-400/30 rounded-full animate-[spin_8s_linear_infinite_reverse]">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 h-2 w-2 bg-cyan-400 rounded-full shadow-[0_0_12px_#22d3ee]" />
        </div>
        <div className="absolute inset-10 border border-white/20 rounded-full animate-[spin_5s_linear_infinite]" />

        {/* Logo core */}
        <div className="relative h-24 w-24 rounded-3xl bg-gradient-to-br from-purple-600 to-cyan-500 p-[2px] shadow-2xl shadow-purple-500/40">
          <div className="h-full w-full rounded-[22px] bg-white dark:bg-slate-950 flex items-center justify-center">
            <FitFusionLogo className="h-14 w-14" />
          </div>
        </div>
      </div>

      {/* Brand */}
      <div className="mt-8 text-center space-y-3">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          Fit<span className="bg-gradient-to-r from-purple-600 to-cyan-500 bg-clip-text text-transparent">Fusion</span>
        </h1>

        {/* Loader dots */}
        <div className="flex items-center justify-center gap-1.5 pt-2">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-[bounce_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0s" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-500 animate-[bounce_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0.15s" }} />
          <span className="h-1.5 w-1.5 rounded-full bg-cyan-500 animate-[bounce_1.4s_ease-in-out_infinite]" style={{ animationDelay: "0.3s" }} />
        </div>
      </div>
    </div>
  )
}
