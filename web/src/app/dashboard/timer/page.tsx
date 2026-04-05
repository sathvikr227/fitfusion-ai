"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import {
  Timer,
  Play,
  Pause,
  RotateCcw,
  Flag,
  Zap,
  Clock,
  ChevronDown,
} from "lucide-react"

// ─── Audio helpers ─────────────────────────────────────────────────────────────

function playBeep(ctx: AudioContext, freq = 880, duration = 0.15, gain = 0.4) {
  const osc = ctx.createOscillator()
  const gainNode = ctx.createGain()
  osc.connect(gainNode)
  gainNode.connect(ctx.destination)
  osc.type = "sine"
  osc.frequency.setValueAtTime(freq, ctx.currentTime)
  gainNode.gain.setValueAtTime(gain, ctx.currentTime)
  gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
  osc.start(ctx.currentTime)
  osc.stop(ctx.currentTime + duration)
}

function playPhaseChime(ctx: AudioContext) {
  // Two-tone chime for phase change
  playBeep(ctx, 660, 0.18, 0.5)
  setTimeout(() => playBeep(ctx, 880, 0.18, 0.5), 200)
}

// ─── Formatting ───────────────────────────────────────────────────────────────

function fmtMMSS(ms: number) {
  const totalSec = Math.ceil(ms / 1000)
  const m = Math.floor(Math.max(0, totalSec) / 60)
  const s = Math.max(0, totalSec) % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

function fmtMMSSms(ms: number) {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  const msDisplay = Math.floor((ms % 1000) / 10)
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(msDisplay).padStart(2, "0")}`
}

function fmtHHMMSS(ms: number) {
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

// ─── Circular Progress Ring ────────────────────────────────────────────────────

function CircularRing({
  progress,
  color,
  size = 240,
  children,
}: {
  progress: number
  color: string
  size?: number
  children: React.ReactNode
}) {
  const r = (size - 20) / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.max(0, Math.min(1, progress)))

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={10}
          className="text-slate-200 dark:text-slate-700"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={10}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.5s ease" }}
        />
      </svg>
      <div className="relative z-10 flex flex-col items-center justify-center">{children}</div>
    </div>
  )
}

// ─── Tab buttons ──────────────────────────────────────────────────────────────

type Tab = "rest" | "hiit" | "stopwatch" | "session"

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "rest", label: "Rest Timer", icon: <Timer className="w-4 h-4" /> },
  { id: "hiit", label: "HIIT", icon: <Zap className="w-4 h-4" /> },
  { id: "stopwatch", label: "Stopwatch", icon: <Clock className="w-4 h-4" /> },
  { id: "session", label: "Session", icon: <Flag className="w-4 h-4" /> },
]

// ─── REST TIMER ───────────────────────────────────────────────────────────────

const REST_PRESETS = [
  { label: "30s", value: 30 },
  { label: "45s", value: 45 },
  { label: "60s", value: 60 },
  { label: "90s", value: 90 },
  { label: "2min", value: 120 },
  { label: "3min", value: 180 },
]

function RestTimer() {
  const [totalSec, setTotalSec] = useState(60)
  const [remaining, setRemaining] = useState(60 * 1000)
  const [running, setRunning] = useState(false)
  const [customInput, setCustomInput] = useState("")
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const beeped = useRef<Set<number>>(new Set())

  const getColor = () => {
    const pct = remaining / (totalSec * 1000)
    if (pct > 0.5) return "#22c55e"
    if (pct > 0.1) return "#f59e0b"
    return "#ef4444"
  }

  const getTextColor = () => {
    const pct = remaining / (totalSec * 1000)
    if (pct > 0.5) return "text-green-500"
    if (pct > 0.1) return "text-amber-500"
    return "text-red-500"
  }

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setRemaining((prev) => {
          const next = Math.max(0, prev - 100)
          const secLeft = Math.ceil(next / 1000)

          if (!audioCtxRef.current) {
            audioCtxRef.current = new AudioContext()
          }
          const ctx = audioCtxRef.current

          if ([3, 2, 1].includes(secLeft) && !beeped.current.has(secLeft)) {
            beeped.current.add(secLeft)
            playBeep(ctx, 660, 0.12)
          }
          if (next === 0 && !beeped.current.has(0)) {
            beeped.current.add(0)
            playBeep(ctx, 880, 0.3, 0.6)
            setRunning(false)
          }
          return next
        })
      }, 100)
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running])

  const setPreset = (sec: number) => {
    setRunning(false)
    setTotalSec(sec)
    setRemaining(sec * 1000)
    beeped.current.clear()
  }

  const reset = () => {
    setRunning(false)
    setRemaining(totalSec * 1000)
    beeped.current.clear()
  }

  const applyCustom = () => {
    const v = parseInt(customInput)
    if (!isNaN(v) && v > 0) setPreset(v)
    setCustomInput("")
  }

  const progress = remaining / (totalSec * 1000)

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Presets */}
      <div className="flex flex-wrap justify-center gap-2">
        {REST_PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => setPreset(p.value)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              totalSec === p.value && remaining === totalSec * 1000
                ? "bg-purple-600 text-white shadow-md"
                : "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            }`}
          >
            {p.label}
          </button>
        ))}
        {/* Custom */}
        <div className="flex gap-1">
          <input
            type="number"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && applyCustom()}
            placeholder="Custom (s)"
            className="w-24 px-3 py-2 rounded-xl text-sm border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          <button
            onClick={applyCustom}
            className="px-3 py-2 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
          >
            Set
          </button>
        </div>
      </div>

      {/* Ring */}
      <CircularRing progress={progress} color={getColor()} size={240}>
        <span className={`text-5xl font-bold tabular-nums ${getTextColor()}`}>{fmtMMSS(remaining)}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400 mt-1">remaining</span>
      </CircularRing>

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={() => setRunning((r) => !r)}
          className="flex items-center gap-2 px-8 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-95"
        >
          {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
        >
          <RotateCcw className="w-5 h-5" />
          Reset
        </button>
      </div>
    </div>
  )
}

// ─── HIIT TIMER ───────────────────────────────────────────────────────────────

function HiitTimer() {
  const [workSec, setWorkSec] = useState(40)
  const [restSec, setRestSec] = useState(20)
  const [totalRounds, setTotalRounds] = useState(8)
  const [phase, setPhase] = useState<"work" | "rest">("work")
  const [round, setRound] = useState(1)
  const [remaining, setRemaining] = useState(40 * 1000)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const intervalRef = useRef<NodeJS.Timeout | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const phaseDuration = phase === "work" ? workSec * 1000 : restSec * 1000

  const getCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext()
    return audioCtxRef.current
  }

  const reset = useCallback(() => {
    setRunning(false)
    setDone(false)
    setPhase("work")
    setRound(1)
    setRemaining(workSec * 1000)
  }, [workSec])

  useEffect(() => {
    if (!running) {
      if (intervalRef.current) clearInterval(intervalRef.current)
      return
    }
    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 100) {
          // Advance phase
          playPhaseChime(getCtx())
          if (phase === "work") {
            setPhase("rest")
            return restSec * 1000
          } else {
            if (round >= totalRounds) {
              setRunning(false)
              setDone(true)
              return 0
            }
            setRound((r) => r + 1)
            setPhase("work")
            return workSec * 1000
          }
        }
        return prev - 100
      })
    }, 100)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running, phase, round, totalRounds, workSec, restSec])

  useEffect(() => { if (!running) reset() }, [workSec, restSec, totalRounds])

  const progress = remaining / phaseDuration
  const color = phase === "work" ? "#ef4444" : "#22c55e"
  const totalProgress = ((round - 1 + (phase === "rest" ? 0.5 : 0)) / totalRounds)

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Config */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-sm">
        {[
          { label: "Work (s)", value: workSec, set: setWorkSec },
          { label: "Rest (s)", value: restSec, set: setRestSec },
          { label: "Rounds", value: totalRounds, set: setTotalRounds },
        ].map(({ label, value, set }) => (
          <div key={label} className="flex flex-col items-center gap-1">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</label>
            <input
              type="number"
              value={value}
              disabled={running}
              onChange={(e) => set(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full text-center px-2 py-2 rounded-xl text-sm font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60"
            />
          </div>
        ))}
      </div>

      {/* Phase badge */}
      <div className={`px-5 py-1.5 rounded-full text-sm font-bold text-white ${phase === "work" ? "bg-red-500" : "bg-green-500"}`}>
        {done ? "Complete!" : phase === "work" ? "WORK" : "REST"}
      </div>

      {/* Ring */}
      <CircularRing progress={progress} color={color} size={240}>
        <span className="text-5xl font-bold tabular-nums text-slate-800 dark:text-white">{fmtMMSS(remaining)}</span>
        <span className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Round {round} / {totalRounds}
        </span>
      </CircularRing>

      {/* Round progress dots */}
      <div className="flex gap-2">
        {Array.from({ length: totalRounds }).map((_, i) => (
          <div
            key={i}
            className={`w-2.5 h-2.5 rounded-full transition-all ${
              i < round - 1
                ? "bg-purple-500"
                : i === round - 1
                ? "bg-purple-300 scale-125"
                : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={() => { if (!done) setRunning((r) => !r) }}
          disabled={done}
          className="flex items-center gap-2 px-8 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-95 disabled:opacity-50"
        >
          {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
        >
          <RotateCcw className="w-5 h-5" />
          Reset
        </button>
      </div>
    </div>
  )
}

// ─── STOPWATCH ────────────────────────────────────────────────────────────────

function StopwatchTimer() {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const [laps, setLaps] = useState<number[]>([])
  const startRef = useRef<number | null>(null)
  const baseRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (running) {
      startRef.current = performance.now()
      const tick = () => {
        setElapsed(baseRef.current + performance.now() - (startRef.current ?? 0))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      baseRef.current = elapsed
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [running])

  const reset = () => {
    setRunning(false)
    setElapsed(0)
    baseRef.current = 0
    setLaps([])
  }

  const lap = () => {
    setLaps((prev) => [...prev, elapsed])
  }

  const lastLapStart = laps.length > 0 ? laps[laps.length - 1] : 0

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Display */}
      <div className="flex flex-col items-center justify-center bg-slate-100 dark:bg-slate-800 rounded-3xl px-12 py-10 shadow-sm">
        <span className="text-6xl font-bold tabular-nums text-slate-800 dark:text-white tracking-tight">
          {fmtMMSSms(elapsed)}
        </span>
        {laps.length > 0 && (
          <span className="text-sm text-slate-500 dark:text-slate-400 mt-2">
            Lap {laps.length + 1}: {fmtMMSSms(elapsed - lastLapStart)}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={() => setRunning((r) => !r)}
          className="flex items-center gap-2 px-8 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-95"
        >
          {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={lap}
          disabled={!running}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95 disabled:opacity-40"
        >
          <Flag className="w-5 h-5" />
          Lap
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
        >
          <RotateCcw className="w-5 h-5" />
          Reset
        </button>
      </div>

      {/* Lap history */}
      {laps.length > 0 && (
        <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Lap History</h3>
          </div>
          <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700/50">
            {[...laps].reverse().map((lapEnd, i) => {
              const idx = laps.length - 1 - i
              const lapStart = idx > 0 ? laps[idx - 1] : 0
              const lapTime = lapEnd - lapStart
              return (
                <div key={idx} className="flex justify-between px-4 py-2.5 text-sm">
                  <span className="text-slate-500 dark:text-slate-400">Lap {idx + 1}</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-white">{fmtMMSSms(lapTime)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── SESSION TIMER ────────────────────────────────────────────────────────────

function SessionTimer() {
  const [elapsed, setElapsed] = useState(0)
  const [running, setRunning] = useState(false)
  const startRef = useRef<number | null>(null)
  const baseRef = useRef(0)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    if (running) {
      startRef.current = performance.now()
      const tick = () => {
        setElapsed(baseRef.current + performance.now() - (startRef.current ?? 0))
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } else {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      baseRef.current = elapsed
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [running])

  const reset = () => {
    setRunning(false)
    setElapsed(0)
    baseRef.current = 0
  }

  const milestones = [15 * 60 * 1000, 30 * 60 * 1000, 45 * 60 * 1000, 60 * 60 * 1000]
  const currentMilestone = milestones.find((m) => elapsed < m) ?? milestones[milestones.length - 1]
  const prevMilestone = milestones[milestones.indexOf(currentMilestone) - 1] ?? 0
  const progress = Math.min(1, (elapsed - prevMilestone) / (currentMilestone - prevMilestone))

  return (
    <div className="flex flex-col items-center gap-8">
      {/* Display */}
      <CircularRing progress={progress} color="#a855f7" size={240}>
        <span className="text-4xl font-bold tabular-nums text-slate-800 dark:text-white">{fmtHHMMSS(elapsed)}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400 mt-1">elapsed</span>
      </CircularRing>

      {/* Milestones */}
      <div className="flex gap-3">
        {["15m", "30m", "45m", "1h"].map((label, i) => {
          const ms = milestones[i]
          const reached = elapsed >= ms
          return (
            <div
              key={label}
              className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all ${
                reached ? "bg-purple-100 dark:bg-purple-900/30" : "bg-slate-100 dark:bg-slate-800"
              }`}
            >
              <span className={`text-xs font-bold ${reached ? "text-purple-600 dark:text-purple-400" : "text-slate-400"}`}>
                {label}
              </span>
              <div className={`w-2 h-2 rounded-full ${reached ? "bg-purple-500" : "bg-slate-300 dark:bg-slate-600"}`} />
            </div>
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex gap-4">
        <button
          onClick={() => setRunning((r) => !r)}
          className="flex items-center gap-2 px-8 py-3 rounded-2xl font-semibold text-white bg-gradient-to-r from-purple-600 to-cyan-500 hover:opacity-90 shadow-md transition-all active:scale-95"
        >
          {running ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          {running ? "Pause" : "Start Session"}
        </button>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-6 py-3 rounded-2xl font-semibold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all active:scale-95"
        >
          <RotateCcw className="w-5 h-5" />
          Reset
        </button>
      </div>

      {elapsed > 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 text-center max-w-xs">
          {elapsed < 15 * 60 * 1000
            ? "Warming up — great start!"
            : elapsed < 30 * 60 * 1000
            ? "Getting into the zone!"
            : elapsed < 45 * 60 * 1000
            ? "Halfway through a solid session!"
            : elapsed < 60 * 60 * 1000
            ? "Strong push — almost an hour!"
            : "Beast mode activated! Over 1 hour!"}
        </p>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TimerPage() {
  const [activeTab, setActiveTab] = useState<Tab>("rest")

  const tabContent = {
    rest: <RestTimer />,
    hiit: <HiitTimer />,
    stopwatch: <StopwatchTimer />,
    session: <SessionTimer />,
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 rounded-2xl bg-gradient-to-br from-purple-500 to-cyan-400 text-white shadow-sm">
              <Timer className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Workout Timer</h1>
          </div>
          <p className="text-slate-500 dark:text-slate-400 text-sm ml-14">Rest, HIIT, stopwatch and session tracking</p>
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
        <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-sm border border-slate-100 dark:border-slate-800 p-8">
          {tabContent[activeTab]}
        </div>
      </div>
    </div>
  )
}
