"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Camera, CameraOff, RefreshCw, Activity, Info,
  Upload, Play, Pause, Film, Volume2, VolumeX,
  Sparkles, TrendingUp, Clock, Target, AlertTriangle,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react"

import { supabase } from "../../../lib/supabase/client"
import { calcAngle } from "../../../lib/pose/angles"
import {
  EXERCISES, EXERCISE_CATEGORIES,
  validateExercise, runFormChecks,
} from "../../../lib/pose/exercises"
import { VoiceCoach } from "../../../lib/pose/voice"
import { buildSummary, computeRomPct, summarizeToBullets } from "../../../lib/pose/insights"
import type { RepRecord, SessionSummary } from "../../../lib/pose/types"

const SKELETON_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
  [25, 27], [26, 28], [27, 29], [28, 30],
]

type Mode = "camera" | "video"
type Stage = "ready" | "down" | "up"

export default function PosePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const landmarkerRef = useRef<any>(null)
  const rafRef = useRef<number>(0)
  const streamRef = useRef<MediaStream | null>(null)
  const videoUrlRef = useRef<string | null>(null)
  const voiceRef = useRef<VoiceCoach | null>(null)

  // Rep state (refs for tight loop, mirrored to state for UI)
  const stageRef = useRef<Stage>("ready")
  const repsRef = useRef(0)
  const rejectedRef = useRef(0)
  const lastTsRef = useRef(-1)
  const repStartTsRef = useRef(0)
  const repMinAngleRef = useRef(180)
  const repMaxAngleRef = useRef(0)
  const repErrorsRef = useRef<Set<string>>(new Set())
  const sessionRepsRef = useRef<RepRecord[]>([])
  const sessionStartRef = useRef<string>("")
  const holdStartTsRef = useRef<number | null>(null)
  const holdAccumRef = useRef(0)

  const [mode, setMode] = useState<Mode>("camera")
  const [exercise, setExercise] = useState("bicep_curl")
  const [isRunning, setIsRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [reps, setReps] = useState(0)
  const [rejected, setRejected] = useState(0)
  const [currentAngle, setCurrentAngle] = useState<number | null>(null)
  const [stage, setStage] = useState<Stage>("ready")
  const [feedback, setFeedback] = useState("")
  const [activeErrors, setActiveErrors] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [voiceOn, setVoiceOn] = useState(true)
  const [holdSeconds, setHoldSeconds] = useState(0)

  // Video upload state
  const [videoFileName, setVideoFileName] = useState<string | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)

  // Summary / AI feedback state
  const [summary, setSummary] = useState<SessionSummary | null>(null)
  const [aiFeedback, setAiFeedback] = useState<string | null>(null)
  const [loadingAi, setLoadingAi] = useState(false)

  const exDef = EXERCISES[exercise]

  // ── Voice coach init ──────────────────────────────────────────────────────
  useEffect(() => {
    voiceRef.current = new VoiceCoach()
    return () => voiceRef.current?.reset()
  }, [])

  useEffect(() => {
    voiceRef.current?.setEnabled(voiceOn)
  }, [voiceOn])

  // ── Load MediaPipe ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { PoseLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision")
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
        )
        const lm = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        })
        if (!cancelled) landmarkerRef.current = lm
      } catch (e: any) {
        if (!cancelled) setError("Failed to load pose model: " + e.message)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  // ── Detection loop ────────────────────────────────────────────────────────
  const runDetection = useCallback(() => {
    const def = EXERCISES[exercise]

    function detect() {
      rafRef.current = requestAnimationFrame(detect)

      const video = videoRef.current
      const canvas = canvasRef.current
      const lm = landmarkerRef.current
      if (!video || !canvas || !lm || video.readyState < 2) return
      if (mode === "video" && video.paused) return

      const ts = mode === "camera" ? performance.now() : video.currentTime * 1000
      if (ts <= lastTsRef.current) return
      lastTsRef.current = ts

      if (mode === "video" && video.duration) {
        setProgress(video.currentTime / video.duration)
      }

      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      const result = lm.detectForVideo(video, ts)
      const ctx = canvas.getContext("2d")!
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (!result.landmarks || result.landmarks.length === 0) {
        setFeedback("No pose detected — make sure your full body is visible")
        return
      }

      const landmarks = result.landmarks[0]
      const W = canvas.width
      const H = canvas.height
      const isCam = mode === "camera"
      const transform = (pt: { x: number; y: number; z: number }) =>
        isCam ? { ...pt, x: 1 - pt.x } : pt

      // Draw skeleton
      ctx.strokeStyle = "rgba(139,92,246,0.85)"
      ctx.lineWidth = 3
      for (const [i, j] of SKELETON_CONNECTIONS) {
        const a = transform(landmarks[i])
        const b = transform(landmarks[j])
        ctx.beginPath()
        ctx.moveTo(a.x * W, a.y * H)
        ctx.lineTo(b.x * W, b.y * H)
        ctx.stroke()
      }

      // Joints
      for (let i = 0; i < landmarks.length; i++) {
        const pt = transform(landmarks[i])
        const isKey = def.repAngle.landmarks.includes(i)
        ctx.beginPath()
        ctx.arc(pt.x * W, pt.y * H, isKey ? 8 : 4, 0, Math.PI * 2)
        ctx.fillStyle = isKey ? "#a855f7" : "rgba(255,255,255,0.7)"
        ctx.fill()
      }

      // Rep angle
      const [li, mi, ri] = def.repAngle.landmarks
      const a = transform(landmarks[li])
      const b = transform(landmarks[mi])
      const c = transform(landmarks[ri])
      const angle = calcAngle(a, b, c)
      setCurrentAngle(Math.round(angle))

      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 20px sans-serif"
      ctx.fillText(`${Math.round(angle)}°`, b.x * W + 12, b.y * H - 8)

      // Form checks — continuously evaluated
      const formIssues = runFormChecks(def, landmarks, angle)
      setActiveErrors(formIssues.map((f: { message: string }) => f.message))
      for (const f of formIssues) {
        if (f.severity === "major") {
          voiceRef.current?.sayCorrection(f.id, f.message, 5000)
        }
        repErrorsRef.current.add(f.message)
      }

      // Track min/max angle for this rep
      if (angle < repMinAngleRef.current) repMinAngleRef.current = angle
      if (angle > repMaxAngleRef.current) repMaxAngleRef.current = angle

      // ── HOLD mode (plank) ───────────────────────────────────────────────
      if (def.kind === "hold") {
        const validation = validateExercise(def, landmarks)
        if (!validation) {
          if (holdStartTsRef.current == null) {
            holdStartTsRef.current = performance.now()
          }
          const elapsed = (performance.now() - holdStartTsRef.current) / 1000 + holdAccumRef.current
          setHoldSeconds(Math.floor(elapsed))
          setFeedback(`Hold — ${Math.floor(elapsed)}s`)

          // Encourage at milestones
          const floored = Math.floor(elapsed)
          if (floored > 0 && floored % 15 === 0 && floored !== Math.floor(elapsed - 0.1)) {
            voiceRef.current?.sayEncourage(`${floored} seconds. Keep holding.`)
          }
        } else {
          // Stopped holding — bank the elapsed time
          if (holdStartTsRef.current != null) {
            const elapsed = (performance.now() - holdStartTsRef.current) / 1000
            holdAccumRef.current += elapsed
            holdStartTsRef.current = null
          }
          setFeedback(validation)
          voiceRef.current?.sayCorrection("hold_broken", validation, 4000)
        }
        return
      }

      // ── REP mode ────────────────────────────────────────────────────────
      let newStage: Stage = stageRef.current

      if (def.repAngle.down(angle)) {
        if (stageRef.current !== "down") {
          newStage = "down"
          // Start of a new rep: reset per-rep accumulators
          repStartTsRef.current = performance.now()
          repMinAngleRef.current = angle
          repMaxAngleRef.current = angle
          repErrorsRef.current = new Set()
          for (const f of formIssues) repErrorsRef.current.add(f.message)
        }
      }

      if (def.repAngle.up(angle) && stageRef.current === "down") {
        // At the top — validate exercise pattern + rep quality before counting
        const validation = validateExercise(def, landmarks)
        const repDurationSec = (performance.now() - repStartTsRef.current) / 1000
        const repRomDeg = repMaxAngleRef.current - repMinAngleRef.current

        let rejectionReason: string | null = validation
        if (!rejectionReason && def.minRepDurationSec && repDurationSec < def.minRepDurationSec) {
          rejectionReason = "Too fast — slow down and control the movement"
        }
        if (!rejectionReason && def.minRomDegrees && repRomDeg < def.minRomDegrees) {
          rejectionReason = "Insufficient range of motion — go through the full range"
        }

        if (rejectionReason) {
          rejectedRef.current += 1
          setRejected(rejectedRef.current)
          setFeedback(rejectionReason)
          voiceRef.current?.sayWarning(rejectionReason)
          newStage = "up"
        } else {
          newStage = "up"
          repsRef.current += 1
          setReps(repsRef.current)

          const durationSec = (performance.now() - repStartTsRef.current) / 1000
          const romPct = computeRomPct(def, repMinAngleRef.current, repMaxAngleRef.current)
          const record: RepRecord = {
            index: repsRef.current,
            minAngle: Math.round(repMinAngleRef.current),
            maxAngle: Math.round(repMaxAngleRef.current),
            romPct,
            durationSec: Math.round(durationSec * 10) / 10,
            errors: Array.from(repErrorsRef.current),
          }
          sessionRepsRef.current.push(record)

          // Voice: count the rep + contextual cue
          let cue: string | undefined
          if (romPct >= 90) cue = "Great range!"
          else if (romPct < 60) cue = "Go deeper next time."
          else if (def.targetTempoSec && durationSec < def.targetTempoSec * 0.6) cue = "Slow it down."
          voiceRef.current?.sayRep(repsRef.current, cue)

          setFeedback(`Rep ${repsRef.current} — ROM ${romPct}%`)
        }
      }

      if (newStage !== stageRef.current) {
        stageRef.current = newStage
        setStage(newStage)
      }

      if (stageRef.current === "ready") setFeedback("Get into starting position")
    }

    rafRef.current = requestAnimationFrame(detect)
  }, [exercise, mode])

  // ── Session lifecycle ─────────────────────────────────────────────────────
  const resetSession = useCallback(() => {
    repsRef.current = 0
    rejectedRef.current = 0
    stageRef.current = "ready"
    sessionRepsRef.current = []
    repErrorsRef.current = new Set()
    holdStartTsRef.current = null
    holdAccumRef.current = 0
    setReps(0)
    setRejected(0)
    setStage("ready")
    setFeedback("")
    setActiveErrors([])
    setHoldSeconds(0)
    setSummary(null)
    setAiFeedback(null)
  }, [])

  const endSession = useCallback(async () => {
    const def = EXERCISES[exercise]
    // Bank remaining hold time
    let totalHold: number | undefined
    if (def.kind === "hold") {
      let h = holdAccumRef.current
      if (holdStartTsRef.current != null) {
        h += (performance.now() - holdStartTsRef.current) / 1000
      }
      totalHold = Math.floor(h)
    }

    const s = buildSummary({
      def,
      reps: sessionRepsRef.current,
      rejectedReps: rejectedRef.current,
      holdSeconds: totalHold,
      startedAt: sessionStartRef.current,
      endedAt: new Date().toISOString(),
    })
    setSummary(s)

    // Request AI feedback
    setLoadingAi(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      const res = await fetch("/api/pose-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          exerciseId: s.exerciseId,
          exerciseName: s.exerciseName,
          totalReps: s.totalReps,
          avgRomPct: s.avgRomPct,
          avgTempoSec: s.avgTempoSec,
          targetTempoSec: def.targetTempoSec,
          rejectedReps: s.rejectedReps,
          holdSeconds: s.holdSeconds,
          formErrorCounts: s.formErrorCounts,
          save: !!token,
        }),
      })
      const json = await res.json()
      if (json.feedback) {
        setAiFeedback(json.feedback)
        voiceRef.current?.sayEncourage("Session complete. Here's your coach feedback.")
      } else {
        setAiFeedback(summarizeToBullets(s, def).join(" "))
      }
    } catch {
      setAiFeedback(summarizeToBullets(s, def).join(" "))
    } finally {
      setLoadingAi(false)
    }
  }, [exercise])

  // ── Camera mode ───────────────────────────────────────────────────────────
  const startCamera = useCallback(async () => {
    setError(null)
    setLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480, facingMode: "user" },
      })
      streamRef.current = stream
      const video = videoRef.current!
      video.srcObject = stream
      await video.play()
      resetSession()
      sessionStartRef.current = new Date().toISOString()
      voiceRef.current?.sayEncourage(`Starting ${EXERCISES[exercise].name}. Get ready.`)
      setIsRunning(true)
    } catch {
      setError("Camera access denied. Please allow camera permissions.")
    } finally {
      setLoading(false)
    }
  }, [exercise, resetSession])

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    const ctx = canvasRef.current?.getContext("2d")
    ctx?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
    setIsRunning(false)
    setCurrentAngle(null)
    lastTsRef.current = -1
    endSession()
  }, [endSession])

  // ── Video upload mode ─────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)

    const url = URL.createObjectURL(file)
    videoUrlRef.current = url
    setVideoFileName(file.name)

    const video = videoRef.current!
    video.srcObject = null
    video.src = url
    video.muted = true
    video.load()
    video.onloadedmetadata = () => {
      setDuration(video.duration)
      video.play().then(() => {
        setIsPlaying(true)
      }).catch(() => {
        // Autoplay blocked — user will need to press play manually
        setIsPlaying(false)
      })
    }

    resetSession()
    sessionStartRef.current = new Date().toISOString()
    setIsRunning(true)
    setIsPlaying(false)
    lastTsRef.current = -1
  }, [resetSession])

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) { video.play(); setIsPlaying(true) }
    else               { video.pause(); setIsPlaying(false) }
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video || !duration) return
    const t = Number(e.target.value) * duration
    video.currentTime = t
    lastTsRef.current = t * 1000 - 1
    setProgress(Number(e.target.value))
  }, [duration])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = () => { setIsPlaying(false); setProgress(1); endSession() }
    video.addEventListener("ended", onEnded)
    return () => video.removeEventListener("ended", onEnded)
  }, [endSession])

  // Start/stop detection loop
  useEffect(() => {
    if (!isRunning) return
    runDetection()
    return () => cancelAnimationFrame(rafRef.current)
  }, [isRunning, runDetection])

  const switchMode = useCallback((newMode: Mode) => {
    cancelAnimationFrame(rafRef.current)
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) {
      videoRef.current.pause()
      videoRef.current.srcObject = null
      videoRef.current.src = ""
    }
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current)
      videoUrlRef.current = null
    }
    const ctx = canvasRef.current?.getContext("2d")
    ctx?.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height)
    setIsRunning(false)
    setIsPlaying(false)
    setVideoFileName(null)
    setCurrentAngle(null)
    setProgress(0)
    setDuration(0)
    lastTsRef.current = -1
    resetSession()
    setMode(newMode)
  }, [resetSession])

  // Cleanup
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)
      voiceRef.current?.reset()
    }
  }, [])

  const stageColor = useMemo(() => ({
    ready: "bg-slate-100 text-slate-600 dark:text-slate-400",
    down: "bg-amber-100 text-amber-700",
    up: "bg-green-100 text-green-700",
  })[stage], [stage])

  const isVideoMode = mode === "video"
  const isCameraMode = mode === "camera"
  const isHoldExercise = exDef.kind === "hold"

  function fmtTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">AI Pose Tracker</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Real-time form coaching with voice feedback and session insights
          </p>
        </div>
        <button
          onClick={() => setVoiceOn((v) => !v)}
          className={`flex items-center gap-2 rounded-2xl px-4 py-2 text-sm font-medium transition-all ${
            voiceOn
              ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow-lg"
              : "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400"
          }`}
          title="Toggle voice coach"
        >
          {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          Voice {voiceOn ? "On" : "Off"}
        </button>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2 rounded-2xl border border-slate-200 bg-slate-50 dark:bg-slate-800/50 p-1 w-fit">
        <button
          onClick={() => switchMode("camera")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
            isCameraMode
              ? "bg-white text-slate-900 dark:text-white shadow-sm"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          <Camera className="h-4 w-4" /> Live Camera
        </button>
        <button
          onClick={() => switchMode("video")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
            isVideoMode
              ? "bg-white text-slate-900 dark:text-white shadow-sm"
              : "text-slate-500 dark:text-slate-400"
          }`}
        >
          <Film className="h-4 w-4" /> Upload Video
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left — video area */}
        <div className="lg:col-span-2 space-y-4">
          {/* Exercise selector */}
          <div className="space-y-2">
            {(Object.entries(EXERCISE_CATEGORIES) as [string, string[]][]).map(([category, keys]) => (
              <div key={category}>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1.5">
                  {category}
                </p>
                <div className="flex flex-wrap gap-2">
                  {keys.map((key: string) => {
                    const def = EXERCISES[key]
                    if (!def) return null
                    return (
                      <button
                        key={key}
                        onClick={() => { setExercise(key); resetSession() }}
                        disabled={isRunning && isCameraMode}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm font-medium transition-all disabled:opacity-50 ${
                          exercise === key
                            ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white border-transparent shadow-lg"
                            : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-purple-300"
                        }`}
                      >
                        <span>{def.icon}</span>{def.name}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Camera hint */}
          <div className="flex items-center gap-2 rounded-2xl bg-blue-50 border border-blue-100 px-4 py-2 text-xs text-blue-700">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {isVideoMode
              ? "Upload a workout video — it'll be analysed frame-by-frame"
              : exDef.cameraHint}
          </div>

          {/* Live form errors banner */}
          {isRunning && activeErrors.length > 0 && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 px-4 py-2 text-xs text-amber-800 space-y-1">
              {activeErrors.slice(0, 2).map((e, i) => (
                <div key={i} className="flex items-start gap-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>{e}</span>
                </div>
              ))}
            </div>
          )}

          {/* Video + Canvas */}
          <div className="relative w-full overflow-hidden rounded-3xl bg-slate-900 aspect-video flex items-center justify-center">
            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              style={isCameraMode ? { transform: "scaleX(-1)" } : undefined}
              muted
              playsInline
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={isCameraMode ? { transform: "scaleX(-1)" } : undefined}
            />
            {!isRunning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80">
                {isVideoMode ? (
                  <><Film className="h-12 w-12 text-slate-400" /><p className="text-slate-300 text-sm">No video loaded</p></>
                ) : (
                  <><Camera className="h-12 w-12 text-slate-400" /><p className="text-slate-300 text-sm">Camera off</p></>
                )}
              </div>
            )}
            {isRunning && feedback && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-2xl bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-sm whitespace-nowrap">
                {feedback}
              </div>
            )}
          </div>

          {/* Camera controls */}
          {isCameraMode && (
            <div className="flex gap-3">
              {!isRunning ? (
                <button
                  onClick={startCamera}
                  disabled={loading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-90 disabled:opacity-60 transition-all"
                >
                  {loading ? (
                    <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" /> Loading model...</>
                  ) : (
                    <><Camera className="h-4 w-4" /> Start Session</>
                  )}
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-all"
                >
                  <CameraOff className="h-4 w-4" /> End Session
                </button>
              )}
              <button
                onClick={resetSession}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 transition-all"
                title="Reset"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Video upload controls */}
          {isVideoMode && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-90 transition-all"
                >
                  <Upload className="h-4 w-4" />
                  {videoFileName ? "Change Video" : "Upload Video"}
                </button>
                <button
                  onClick={resetSession}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 transition-all"
                  title="Reset"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
              <input ref={fileInputRef} type="file" accept="video/*" className="hidden" onChange={handleFileChange} />
              {videoFileName && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate px-1">📁 {videoFileName}</p>
              )}
              {isRunning && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-10 shrink-0">
                      {fmtTime((videoRef.current?.currentTime) ?? 0)}
                    </span>
                    <input
                      type="range" min={0} max={1} step={0.001}
                      value={progress} onChange={handleSeek}
                      className="flex-1 accent-purple-600"
                    />
                    <span className="text-xs text-slate-400 w-10 shrink-0 text-right">{fmtTime(duration)}</span>
                  </div>
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={togglePlayPause}
                      className="flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition-all"
                    >
                      {isPlaying ? <><Pause className="h-4 w-4" /> Pause</> : <><Play className="h-4 w-4" /> Play</>}
                    </button>
                    <button
                      onClick={endSession}
                      className="flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-50 transition-all"
                    >
                      Get AI Feedback
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — Stats */}
        <div className="space-y-4">
          {/* Primary stat: reps OR hold timer */}
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              {isHoldExercise ? "Hold Time" : "Valid Reps"}
            </p>
            <p className="mt-2 text-7xl font-extrabold text-slate-900 dark:text-white tabular-nums">
              {isHoldExercise ? holdSeconds : reps}
              {isHoldExercise && <span className="text-2xl ml-1">s</span>}
            </p>
            {!isHoldExercise && (
              <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${stageColor}`}>
                {stage === "ready" ? "Ready" : stage === "down" ? "Down ↓" : "Up ↑"}
              </span>
            )}
            {rejected > 0 && (
              <p className="mt-2 text-xs text-amber-600 flex items-center justify-center gap-1">
                <XCircle className="h-3 w-3" /> {rejected} rejected
              </p>
            )}
          </div>

          {/* Current angle */}
          <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">Joint Angle</p>
            {currentAngle !== null ? (
              <>
                <p className="text-4xl font-bold text-slate-900 dark:text-white">{currentAngle}°</p>
                <div className="mt-3 h-2 w-full rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-100"
                    style={{ width: `${Math.min((currentAngle / 180) * 100, 100)}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-slate-400"><span>0°</span><span>180°</span></div>
              </>
            ) : (
              <p className="text-2xl font-bold text-slate-300">--</p>
            )}
          </div>

          {/* Form tip */}
          <div className="rounded-3xl border border-purple-100 bg-purple-50 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-purple-600" />
              <p className="text-sm font-semibold text-purple-900">Form Tip</p>
            </div>
            <p className="text-sm text-purple-700">{exDef.formTip}</p>
          </div>
        </div>
      </div>

      {/* ── Session Summary ──────────────────────────────────────────────── */}
      {summary && (
        <div className="rounded-3xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm space-y-5">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-600" />
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Session Summary</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatBox icon={CheckCircle2} label="Reps" value={summary.totalReps.toString()} accent="text-green-600" />
            <StatBox icon={Target} label="Avg ROM" value={`${summary.avgRomPct}%`} accent="text-purple-600" />
            <StatBox icon={Clock} label="Tempo" value={`${summary.avgTempoSec}s`} accent="text-cyan-600" />
            <StatBox icon={TrendingUp} label="Rejected" value={summary.rejectedReps.toString()} accent="text-amber-600" />
          </div>

          {summary.holdSeconds != null && (
            <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Hold</p>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">{summary.holdSeconds}s</p>
            </div>
          )}

          {Object.keys(summary.formErrorCounts).length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Form issues</p>
              <div className="space-y-1.5">
                {(Object.entries(summary.formErrorCounts) as [string, number][])
                  .sort((a, b) => b[1] - a[1])
                  .map(([msg, count]) => (
                    <div key={msg} className="flex items-start gap-2 text-sm">
                      <span className="shrink-0 mt-0.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">{count}×</span>
                      <span className="text-slate-700 dark:text-slate-300">{msg}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* AI Feedback */}
          <div className="rounded-2xl bg-gradient-to-br from-purple-50 to-cyan-50 border border-purple-100 p-5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-4 w-4 text-purple-600" />
              <p className="text-sm font-semibold text-purple-900">AI Coach Feedback</p>
            </div>
            {loadingAi ? (
              <div className="flex items-center gap-2 text-sm text-purple-700">
                <Loader2 className="h-4 w-4 animate-spin" /> Generating personalised feedback...
              </div>
            ) : aiFeedback ? (
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{aiFeedback}</p>
            ) : (
              <p className="text-sm text-slate-500">No feedback available.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function StatBox({
  icon: Icon, label, value, accent,
}: { icon: React.ElementType; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
      <Icon className={`h-4 w-4 ${accent} mb-1`} />
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</p>
    </div>
  )
}
