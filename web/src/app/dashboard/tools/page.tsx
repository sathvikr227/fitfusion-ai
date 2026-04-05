"use client"

import { useState } from "react"
import {
  Calculator,
  Flame,
  Dumbbell,
  Activity,
  Check,
  ChevronDown,
  User,
  Scale,
  Ruler,
  Heart,
  TrendingUp,
  TrendingDown,
  Minus,
  Zap,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = "bmr" | "bodyfat" | "onerm" | "calories"

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "bmr", label: "BMR & TDEE", icon: <Flame className="w-4 h-4" /> },
  { id: "bodyfat", label: "Body Fat %", icon: <Activity className="w-4 h-4" /> },
  { id: "onerm", label: "1RM", icon: <Dumbbell className="w-4 h-4" /> },
  { id: "calories", label: "Calories Burned", icon: <Zap className="w-4 h-4" /> },
]

// ─── BMR & TDEE ──────────────────────────────────────────────────────────────

const ACTIVITY_LEVELS = [
  { label: "Sedentary (desk job, no exercise)", multiplier: 1.2 },
  { label: "Light (1-3 days/week exercise)", multiplier: 1.375 },
  { label: "Moderate (3-5 days/week exercise)", multiplier: 1.55 },
  { label: "Active (6-7 days/week hard exercise)", multiplier: 1.725 },
  { label: "Very Active (physical job + hard training)", multiplier: 1.9 },
]

const GOAL_CARDS = [
  { label: "Aggressive Cut", offset: -750, color: "from-red-500 to-orange-500", icon: TrendingDown, desc: "Rapid fat loss" },
  { label: "Cut", offset: -500, color: "from-orange-500 to-amber-400", icon: TrendingDown, desc: "Steady fat loss" },
  { label: "Maintenance", offset: 0, color: "from-blue-500 to-cyan-400", icon: Minus, desc: "Maintain weight" },
  { label: "Bulk", offset: 300, color: "from-green-500 to-emerald-400", icon: TrendingUp, desc: "Lean muscle gain" },
]

function BmrCalculator() {
  const [age, setAge] = useState("")
  const [gender, setGender] = useState<"male" | "female">("male")
  const [weight, setWeight] = useState("")
  const [height, setHeight] = useState("")
  const [activity, setActivity] = useState(0)
  const [result, setResult] = useState<{ bmr: number; tdee: number } | null>(null)

  const calculate = () => {
    const a = parseFloat(age)
    const w = parseFloat(weight)
    const h = parseFloat(height)
    if (!a || !w || !h || a <= 0 || w <= 0 || h <= 0) return
    const bmr =
      gender === "male"
        ? 10 * w + 6.25 * h - 5 * a + 5
        : 10 * w + 6.25 * h - 5 * a - 161
    const tdee = bmr * ACTIVITY_LEVELS[activity].multiplier
    setResult({ bmr: Math.round(bmr), tdee: Math.round(tdee) })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Inputs */}
      <div className="grid grid-cols-2 gap-4">
        {/* Gender */}
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Gender</label>
          <div className="flex gap-2">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGender(g)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
                  gender === g
                    ? "bg-purple-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {[
          { label: "Age (years)", val: age, set: setAge, placeholder: "25" },
          { label: "Weight (kg)", val: weight, set: setWeight, placeholder: "75" },
          { label: "Height (cm)", val: height, set: setHeight, placeholder: "175" },
        ].map(({ label, val, set, placeholder }) => (
          <div key={label}>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{label}</label>
            <input
              type="number"
              value={val}
              onChange={(e) => set(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        ))}

        {/* Activity level */}
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Activity Level</label>
          <div className="relative">
            <select
              value={activity}
              onChange={(e) => setActivity(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 appearance-none pr-8"
            >
              {ACTIVITY_LEVELS.map((a, i) => (
                <option key={i} value={i}>{a.label}</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <button
        onClick={calculate}
        className="w-full py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-[0.98]"
      >
        Calculate
      </button>

      {result && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300">
          {/* BMR + TDEE */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-4 text-center">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Basal Metabolic Rate</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{result.bmr}</p>
              <p className="text-xs text-slate-400">kcal/day (at rest)</p>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-cyan-50 dark:from-purple-900/20 dark:to-cyan-900/20 rounded-2xl p-4 text-center border border-purple-100 dark:border-purple-800/30">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">TDEE (Maintenance)</p>
              <p className="text-3xl font-bold text-purple-600 dark:text-purple-400">{result.tdee}</p>
              <p className="text-xs text-slate-400">kcal/day</p>
            </div>
          </div>

          {/* Goal cards */}
          <div className="grid grid-cols-2 gap-3">
            {GOAL_CARDS.map(({ label, offset, color, icon: Icon, desc }) => (
              <div key={label} className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
                <div className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gradient-to-r ${color} text-white text-xs font-semibold mb-2`}>
                  <Icon className="w-3 h-3" />
                  {label}
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{result.tdee + offset}</p>
                <p className="text-xs text-slate-400 mt-0.5">{desc} · {offset > 0 ? "+" : ""}{offset} kcal</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── BODY FAT % ───────────────────────────────────────────────────────────────

const BF_CATEGORIES = [
  { label: "Essential Fat", maleMax: 5, femaleMax: 13, color: "bg-blue-500" },
  { label: "Athletic", maleMax: 13, femaleMax: 20, color: "bg-green-500" },
  { label: "Fitness", maleMax: 17, femaleMax: 24, color: "bg-emerald-400" },
  { label: "Average", maleMax: 25, femaleMax: 31, color: "bg-amber-400" },
  { label: "Obese", maleMax: Infinity, femaleMax: Infinity, color: "bg-red-500" },
]

function getBfCategory(bf: number, gender: "male" | "female") {
  const key = gender === "male" ? "maleMax" : "femaleMax"
  return BF_CATEGORIES.find((c) => bf <= c[key]) ?? BF_CATEGORIES[BF_CATEGORIES.length - 1]
}

function BodyFatCalculator() {
  const [gender, setGender] = useState<"male" | "female">("male")
  const [neck, setNeck] = useState("")
  const [waist, setWaist] = useState("")
  const [hips, setHips] = useState("")
  const [heightCm, setHeightCm] = useState("")
  const [result, setResult] = useState<number | null>(null)

  const calculate = () => {
    const n = parseFloat(neck)
    const w = parseFloat(waist)
    const h = parseFloat(heightCm)
    const hp = parseFloat(hips)

    if (!n || !w || !h || n <= 0 || w <= 0 || h <= 0) return
    if (gender === "female" && (!hp || hp <= 0)) return

    let bf: number
    if (gender === "male") {
      bf = 86.01 * Math.log10(w - n) - 70.041 * Math.log10(h) + 36.76
    } else {
      bf = 163.205 * Math.log10(w + hp - n) - 97.684 * Math.log10(h) - 78.387
    }
    setResult(Math.max(0, parseFloat(bf.toFixed(1))))
  }

  const category = result !== null ? getBfCategory(result, gender) : null
  const gaugeMax = gender === "male" ? 35 : 45
  const gaugeProgress = result !== null ? Math.min(1, result / gaugeMax) : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        {/* Gender */}
        <div className="col-span-2">
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Gender</label>
          <div className="flex gap-2">
            {(["male", "female"] as const).map((g) => (
              <button
                key={g}
                onClick={() => { setGender(g); setResult(null) }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold capitalize transition-all ${
                  gender === g
                    ? "bg-purple-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        {[
          { label: "Neck (cm)", val: neck, set: setNeck, placeholder: "38" },
          { label: "Waist (cm)", val: waist, set: setWaist, placeholder: "85" },
          ...(gender === "female" ? [{ label: "Hips (cm)", val: hips, set: setHips, placeholder: "95" }] : []),
          { label: "Height (cm)", val: heightCm, set: setHeightCm, placeholder: "175" },
        ].map(({ label, val, set, placeholder }) => (
          <div key={label}>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">{label}</label>
            <input
              type="number"
              value={val}
              onChange={(e) => set(e.target.value)}
              placeholder={placeholder}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        ))}
      </div>

      <button
        onClick={calculate}
        className="w-full py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-[0.98]"
      >
        Estimate Body Fat
      </button>

      {result !== null && category && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300">
          {/* Result */}
          <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-6 text-center">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Estimated Body Fat</p>
            <p className="text-5xl font-bold text-slate-900 dark:text-white mb-2">{result}<span className="text-2xl">%</span></p>
            <span className={`inline-block px-4 py-1 rounded-full text-white text-sm font-semibold ${category.color}`}>
              {category.label}
            </span>
          </div>

          {/* Gauge bar */}
          <div>
            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
              <span>Essential</span>
              <span>Athletic</span>
              <span>Fitness</span>
              <span>Average</span>
              <span>Obese</span>
            </div>
            <div className="relative h-4 rounded-full overflow-hidden bg-gradient-to-r from-blue-500 via-green-400 via-amber-400 to-red-500">
              <div
                className="absolute top-0 bottom-0 w-1 bg-white rounded-full shadow-md transition-all duration-500"
                style={{ left: `calc(${gaugeProgress * 100}% - 2px)` }}
              />
            </div>
            <p className="text-xs text-center text-slate-400 mt-1.5">{result}% (Navy Method)</p>
          </div>

          {/* Categories reference */}
          <div className="grid grid-cols-5 gap-1">
            {BF_CATEGORIES.map((cat) => {
              const max = gender === "male" ? cat.maleMax : cat.femaleMax
              const active = category.label === cat.label
              return (
                <div
                  key={cat.label}
                  className={`rounded-xl p-2 text-center transition-all ${active ? "ring-2 ring-purple-500 bg-white dark:bg-slate-800" : "bg-slate-50 dark:bg-slate-800/50"}`}
                >
                  <div className={`w-2 h-2 rounded-full mx-auto mb-1 ${cat.color}`} />
                  <p className="text-[10px] font-semibold text-slate-700 dark:text-slate-300 leading-tight">{cat.label}</p>
                  <p className="text-[10px] text-slate-400">{max === Infinity ? `>${gender === "male" ? "25" : "31"}%` : `≤${max}%`}</p>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── 1RM CALCULATOR ───────────────────────────────────────────────────────────

function calc1RM(weight: number, reps: number) {
  const epley = weight * (1 + reps / 30)
  const brzycki = weight * (36 / (37 - reps))
  const lander = (100 * weight) / (101.3 - 2.67123 * reps)
  const lombardi = weight * Math.pow(reps, 0.1)
  const avg = (epley + brzycki + lander + lombardi) / 4
  return { epley, brzycki, lander, lombardi, avg }
}

const RM_PERCENTAGES: Record<number, number> = {
  1: 1.0, 3: 0.93, 5: 0.87, 8: 0.8, 10: 0.75, 12: 0.7, 15: 0.64,
}

function OneRMCalculator() {
  const [weightKg, setWeightKg] = useState("")
  const [reps, setReps] = useState("")
  const [result, setResult] = useState<ReturnType<typeof calc1RM> | null>(null)

  const calculate = () => {
    const w = parseFloat(weightKg)
    const r = parseInt(reps)
    if (!w || !r || w <= 0 || r < 1 || r > 30) return
    setResult(calc1RM(w, r))
  }

  const formulas = result
    ? [
        { name: "Epley", value: result.epley },
        { name: "Brzycki", value: result.brzycki },
        { name: "Lander", value: result.lander },
        { name: "Lombardi", value: result.lombardi },
      ]
    : []

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Weight Lifted (kg)</label>
          <input
            type="number"
            value={weightKg}
            onChange={(e) => setWeightKg(e.target.value)}
            placeholder="100"
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Reps Performed (1-12)</label>
          <input
            type="number"
            value={reps}
            onChange={(e) => setReps(e.target.value)}
            placeholder="5"
            min={1}
            max={12}
            className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>
      </div>

      <button
        onClick={calculate}
        className="w-full py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-[0.98]"
      >
        Calculate 1RM
      </button>

      {result && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300">
          {/* Average highlight */}
          <div className="bg-gradient-to-br from-purple-50 to-cyan-50 dark:from-purple-900/20 dark:to-cyan-900/20 rounded-2xl p-5 text-center border border-purple-100 dark:border-purple-800/30">
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Estimated 1RM (Average)</p>
            <p className="text-5xl font-bold text-purple-600 dark:text-purple-400">{result.avg.toFixed(1)}<span className="text-xl ml-1">kg</span></p>
          </div>

          {/* Individual formulas */}
          <div className="grid grid-cols-2 gap-3">
            {formulas.map(({ name, value }) => (
              <div key={name} className="bg-white dark:bg-slate-800 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-700">
                <p className="text-xs text-slate-400 mb-1">{name}</p>
                <p className="text-2xl font-bold text-slate-900 dark:text-white">{value.toFixed(1)} <span className="text-sm font-normal text-slate-400">kg</span></p>
              </div>
            ))}
          </div>

          {/* Rep range table */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden">
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Estimated Max by Rep Range</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 border-b border-slate-100 dark:border-slate-700">
                  <th className="px-4 py-2 text-left">Reps</th>
                  <th className="px-4 py-2 text-right">Est. Weight (kg)</th>
                  <th className="px-4 py-2 text-right">% of 1RM</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 dark:divide-slate-700/50">
                {Object.entries(RM_PERCENTAGES).map(([rep, pct]) => (
                  <tr key={rep} className={rep === "1" ? "bg-purple-50 dark:bg-purple-900/20" : ""}>
                    <td className="px-4 py-2.5 text-slate-700 dark:text-slate-300 font-medium">{rep} {rep === "1" ? "(1RM)" : "reps"}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-slate-900 dark:text-white">{(result.avg * pct).toFixed(1)}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{Math.round(pct * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── CALORIES BURNED ─────────────────────────────────────────────────────────

const ACTIVITIES = [
  { label: "Walking (moderate pace)", met: 3.5 },
  { label: "Walking (brisk pace)", met: 4.3 },
  { label: "Running (8 km/h)", met: 8.3 },
  { label: "Running (10 km/h)", met: 10.0 },
  { label: "Running (12 km/h)", met: 11.8 },
  { label: "Cycling (leisure)", met: 4.0 },
  { label: "Cycling (vigorous)", met: 10.0 },
  { label: "Swimming (leisure)", met: 6.0 },
  { label: "Swimming (vigorous laps)", met: 9.8 },
  { label: "Weightlifting (general)", met: 3.5 },
  { label: "Weightlifting (vigorous)", met: 6.0 },
  { label: "HIIT", met: 10.3 },
  { label: "Yoga", met: 2.5 },
  { label: "Pilates", met: 3.0 },
  { label: "Jump Rope", met: 11.8 },
  { label: "Basketball", met: 6.5 },
  { label: "Football (soccer)", met: 7.0 },
  { label: "Tennis", met: 7.3 },
  { label: "Rowing (moderate)", met: 7.0 },
  { label: "Elliptical Trainer", met: 5.0 },
  { label: "Stair Climbing", met: 8.8 },
  { label: "Boxing / Sparring", met: 7.8 },
  { label: "Dancing", met: 4.8 },
  { label: "Rock Climbing", met: 7.5 },
]

function CaloriesCalculator() {
  const [activityIdx, setActivityIdx] = useState(0)
  const [duration, setDuration] = useState("")
  const [weight, setWeight] = useState("")
  const [result, setResult] = useState<{ total: number; perMin: number } | null>(null)
  const [toast, setToast] = useState(false)

  const calculate = () => {
    const d = parseFloat(duration)
    const w = parseFloat(weight)
    if (!d || !w || d <= 0 || w <= 0) return
    const met = ACTIVITIES[activityIdx].met
    const total = (met * w * 3.5 / 200) * d
    setResult({ total: Math.round(total), perMin: parseFloat((total / d).toFixed(1)) })
  }

  const logToCardio = () => {
    if (!result) return
    setToast(true)
    setTimeout(() => setToast(false), 3000)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4">
        {/* Activity */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Activity</label>
          <div className="relative">
            <select
              value={activityIdx}
              onChange={(e) => setActivityIdx(Number(e.target.value))}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 appearance-none pr-8"
            >
              {ACTIVITIES.map((a, i) => (
                <option key={i} value={i}>{a.label} (MET {a.met})</option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Duration (minutes)</label>
            <input
              type="number"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              placeholder="45"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">Body Weight (kg)</label>
            <input
              type="number"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="75"
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>
      </div>

      <button
        onClick={calculate}
        className="w-full py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-[0.98]"
      >
        Calculate
      </button>

      {result && (
        <div className="flex flex-col gap-4 animate-in fade-in duration-300">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 rounded-2xl p-5 text-center border border-orange-100 dark:border-orange-800/30">
              <Flame className="w-5 h-5 text-orange-500 mx-auto mb-2" />
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Total Calories</p>
              <p className="text-4xl font-bold text-orange-500">{result.total}</p>
              <p className="text-xs text-slate-400 mt-0.5">kcal</p>
            </div>
            <div className="bg-slate-50 dark:bg-slate-800 rounded-2xl p-5 text-center">
              <Zap className="w-5 h-5 text-purple-500 mx-auto mb-2" />
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Per Minute</p>
              <p className="text-4xl font-bold text-slate-900 dark:text-white">{result.perMin}</p>
              <p className="text-xs text-slate-400 mt-0.5">kcal/min</p>
            </div>
          </div>

          {/* Activity summary */}
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-4 border border-slate-100 dark:border-slate-700 shadow-sm">
            <div className="flex justify-between text-sm">
              <span className="text-slate-500 dark:text-slate-400">Activity</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{ACTIVITIES[activityIdx].label}</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-slate-500 dark:text-slate-400">MET Value</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{ACTIVITIES[activityIdx].met}</span>
            </div>
            <div className="flex justify-between text-sm mt-2">
              <span className="text-slate-500 dark:text-slate-400">Duration</span>
              <span className="font-semibold text-slate-800 dark:text-slate-200">{duration} minutes</span>
            </div>
          </div>

          <button
            onClick={logToCardio}
            className="w-full py-3 rounded-2xl font-semibold text-purple-600 dark:text-purple-400 border-2 border-purple-200 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-all active:scale-[0.98]"
          >
            Log to Cardio
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 bg-green-500 text-white px-6 py-3 rounded-2xl shadow-lg animate-in slide-in-from-bottom-4 duration-300">
          <Check className="w-4 h-4" />
          <span className="text-sm font-semibold">Logged to Cardio!</span>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("bmr")

  const tabContent = {
    bmr: <BmrCalculator />,
    bodyfat: <BodyFatCalculator />,
    onerm: <OneRMCalculator />,
    calories: <CaloriesCalculator />,
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-400 text-white shadow-sm">
              <Calculator className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Fitness Tools</h1>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm ml-14">Science-backed calculators for smarter training</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl mb-8">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        {/* Content card */}
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 p-6 md:p-8">
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  )
}
