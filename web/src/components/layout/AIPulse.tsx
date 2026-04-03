export default function AIPulse() {
  return (
    <div className="flex flex-col items-center justify-center">
      <div className="relative h-48 w-48 flex items-center justify-center">
        {/* Layer 1: The "Fusion" Rings */}
        <div className="absolute inset-0 border-[1px] border-purple-500/20 rounded-full animate-[spin_10s_linear_infinite]" />
        <div className="absolute inset-4 border-[1px] border-cyan-400/30 rounded-full animate-[spin_6s_linear_infinite_reverse]" />
        <div className="absolute inset-8 border-[1px] border-white/10 rounded-full animate-[spin_3s_linear_infinite]" />
        
        {/* Layer 2: The Core (Signifying AI Intelligence) */}
        <div className="relative h-16 w-16">
          {/* Breathing Glow */}
          <div className="absolute inset-0 bg-gradient-to-tr from-purple-600 to-cyan-400 rounded-full blur-md animate-pulse" />
          <div className="relative h-full w-full bg-slate-950 rounded-full border border-white/20 flex items-center justify-center overflow-hidden">
            {/* Moving "Neural" particles inside the core */}
            <div className="absolute inset-0 opacity-50 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-purple-500/40 via-transparent to-transparent animate-pulse" />
            <span className="text-white font-bold text-xl tracking-tighter z-10">FF</span>
          </div>
        </div>

        {/* Layer 3: Orbiting "Data Nodes" */}
        <div className="absolute w-full h-full animate-[spin_4s_ease-in-out_infinite]">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 h-2 w-2 bg-cyan-400 rounded-full shadow-[0_0_10px_#22d3ee]" />
        </div>
      </div>

      {/* Purpose-driven Text */}
      <div className="mt-10 text-center space-y-2">
        <h1 className="text-3xl font-light tracking-[0.2em] text-white uppercase">
          FitFusion <span className="font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-300">AI</span>
        </h1>
        <p className="text-slate-400 text-sm font-medium tracking-widest uppercase opacity-60">
          Neural Fitness Integration
        </p>
      </div>
    </div>
  )
}