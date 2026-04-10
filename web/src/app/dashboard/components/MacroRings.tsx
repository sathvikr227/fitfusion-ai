"use client"

type MacroData = { consumed: number; target: number }

interface MacroRingsProps {
  calories: MacroData
  protein: MacroData
  carbs: MacroData
  fat: MacroData
}

function Ring({
  value,
  max,
  color,
  label,
  unit,
  size = 72,
  stroke = 6,
}: {
  value: number
  max: number
  color: string
  label: string
  unit: string
  size?: number
  stroke?: number
}) {
  const r = (size - stroke * 2) / 2
  const circumference = 2 * Math.PI * r
  const pct = max > 0 ? Math.min(value / max, 1) : 0
  const dashOffset = circumference * (1 - pct)

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            className="text-slate-100 dark:text-slate-700"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: "stroke-dashoffset 0.5s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs font-bold text-slate-900 dark:text-white leading-none">{value}</span>
          <span className="text-[9px] text-slate-400 leading-none">{unit}</span>
        </div>
      </div>
      <div className="text-center">
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</p>
        <p className="text-[10px] text-slate-400">/ {max}{unit}</p>
      </div>
    </div>
  )
}

export function MacroRings({ calories, protein, carbs, fat }: MacroRingsProps) {
  if (!calories.target && !protein.target && !carbs.target && !fat.target) return null

  return (
    <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Today's Nutrition</p>
      <div className="grid grid-cols-4 gap-2">
        <Ring value={Math.round(calories.consumed)} max={calories.target} color="#9333ea" label="Calories" unit="kcal" size={72} stroke={6} />
        <Ring value={Math.round(protein.consumed)} max={protein.target} color="#3b82f6" label="Protein" unit="g" size={72} stroke={6} />
        <Ring value={Math.round(carbs.consumed)} max={carbs.target} color="#f59e0b" label="Carbs" unit="g" size={72} stroke={6} />
        <Ring value={Math.round(fat.consumed)} max={fat.target} color="#f43f5e" label="Fat" unit="g" size={72} stroke={6} />
      </div>
    </div>
  )
}
