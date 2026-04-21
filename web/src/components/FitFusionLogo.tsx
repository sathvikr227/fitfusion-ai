export default function FitFusionLogo({ className = "w-16 h-16" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#0891b2" />
        </linearGradient>
        <linearGradient id="shineGrad" x1="0" y1="0" x2="0" y2="80" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="white" stopOpacity="0.25" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Hexagon background */}
      <polygon
        points="40,4 72,22 72,58 40,76 8,58 8,22"
        fill="url(#logoGrad)"
        rx="4"
      />
      {/* Shine overlay */}
      <polygon
        points="40,4 72,22 72,58 40,76 8,58 8,22"
        fill="url(#shineGrad)"
      />
      {/* Hexagon border */}
      <polygon
        points="40,4 72,22 72,58 40,76 8,58 8,22"
        fill="none"
        stroke="white"
        strokeWidth="1"
        strokeOpacity="0.2"
      />

      {/* Neural connection lines (background, subtle) */}
      <line x1="20" y1="22" x2="60" y2="22" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" />
      <line x1="20" y1="22" x2="16" y2="56" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" />
      <line x1="60" y1="22" x2="64" y2="56" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" />
      <line x1="16" y1="56" x2="64" y2="56" stroke="white" strokeWidth="0.6" strokeOpacity="0.2" />

      {/* Human figure — victory / power pose */}

      {/* Head with circuit ring */}
      <circle cx="40" cy="18" r="5.5" fill="white" />
      <circle cx="40" cy="18" r="8" fill="none" stroke="white" strokeWidth="0.8" strokeOpacity="0.35" strokeDasharray="2.5 2" />

      {/* Body */}
      <rect x="36" y="25" width="8" height="14" rx="2.5" fill="white" />

      {/* Left arm raised */}
      <line x1="36" y1="29" x2="20" y2="22" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
      {/* Right arm raised */}
      <line x1="44" y1="29" x2="60" y2="22" stroke="white" strokeWidth="3.5" strokeLinecap="round" />

      {/* Left leg */}
      <line x1="38" y1="39" x2="28" y2="57" stroke="white" strokeWidth="3.5" strokeLinecap="round" />
      {/* Right leg */}
      <line x1="42" y1="39" x2="52" y2="57" stroke="white" strokeWidth="3.5" strokeLinecap="round" />

      {/* Neural nodes at hands */}
      <circle cx="20" cy="22" r="3.5" fill="white" filter="url(#glow)" />
      <circle cx="60" cy="22" r="3.5" fill="white" filter="url(#glow)" />

      {/* Neural nodes at feet */}
      <circle cx="28" cy="57" r="3" fill="white" opacity="0.85" />
      <circle cx="52" cy="57" r="3" fill="white" opacity="0.85" />

      {/* Small accent dots on arms (circuit nodes) */}
      <circle cx="28" cy="25.5" r="1.5" fill="white" opacity="0.6" />
      <circle cx="52" cy="25.5" r="1.5" fill="white" opacity="0.6" />
    </svg>
  )
}
