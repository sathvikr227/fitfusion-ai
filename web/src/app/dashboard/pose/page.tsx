"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import {
  Camera, CameraOff, RefreshCw, Activity, Info,
  Upload, Play, Pause, Film,
} from "lucide-react"

// ── Landmark indices ──────────────────────────────────────────────────────────
const LM = {
  R_SHOULDER: 12, L_SHOULDER: 11,
  R_ELBOW: 14,    L_ELBOW: 13,
  R_WRIST: 16,    L_WRIST: 15,
  R_HIP: 24,      L_HIP: 23,
  R_KNEE: 26,     L_KNEE: 25,
  R_ANKLE: 28,    L_ANKLE: 27,
}

interface ExerciseDef {
  name: string
  icon: string
  landmarks: [number, number, number]
  downCondition: (a: number) => boolean
  upCondition: (a: number) => boolean
  formTip: string
  cameraHint: string
}

const EXERCISES: Record<string, ExerciseDef> = {
  bicep_curl: {
    name: "Bicep Curl",
    icon: "💪",
    landmarks: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
    downCondition: (a) => a > 150,
    upCondition: (a) => a < 50,
    formTip: "Keep elbow pinned to your side throughout the movement",
    cameraHint: "Face camera sideways — show your full arm",
  },
  squat: {
    name: "Squat",
    icon: "🏋️",
    landmarks: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
    downCondition: (a) => a < 100,
    upCondition: (a) => a > 160,
    formTip: "Keep chest up, knees tracking over toes",
    cameraHint: "Stand sideways to the camera — full body visible",
  },
  pushup: {
    name: "Push-up",
    icon: "🔄",
    landmarks: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
    downCondition: (a) => a < 90,
    upCondition: (a) => a > 150,
    formTip: "Keep a straight line from head to heels — no sagging hips",
    cameraHint: "Place camera at floor level, sideways to your body",
  },
  shoulder_press: {
    name: "Shoulder Press",
    icon: "⬆️",
    landmarks: [LM.R_ELBOW, LM.R_SHOULDER, LM.R_HIP],
    downCondition: (a) => a < 70,
    upCondition: (a) => a > 150,
    formTip: "Brace your core — don't arch your lower back",
    cameraHint: "Face camera sideways — full upper body visible",
  },
}

function calcAngle(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number }
): number {
  const rad =
    Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let deg = Math.abs((rad * 180) / Math.PI)
  if (deg > 180) deg = 360 - deg
  return deg
}

const SKELETON_CONNECTIONS: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [24, 26],
  [25, 27], [26, 28],
]

type Mode = "camera" | "video"

export default function PosePage() {
  const videoRef    = useRef<HTMLVideoElement>(null)
  const canvasRef   = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const landmarkerRef = useRef<any>(null)
  const rafRef       = useRef<number>(0)
  const streamRef    = useRef<MediaStream | null>(null)
  const videoUrlRef  = useRef<string | null>(null)
  const stageRef     = useRef<"ready" | "down" | "up">("ready")
  const repsRef      = useRef(0)
  const lastTsRef    = useRef(-1)

  const [mode, setMode]               = useState<Mode>("camera")
  const [exercise, setExercise]       = useState("bicep_curl")
  const [isRunning, setIsRunning]     = useState(false)
  const [loading, setLoading]         = useState(false)
  const [reps, setReps]               = useState(0)
  const [currentAngle, setCurrentAngle] = useState<number | null>(null)
  const [stage, setStage]             = useState<"ready" | "down" | "up">("ready")
  const [feedback, setFeedback]       = useState("")
  const [error, setError]             = useState<string | null>(null)
  // video upload state
  const [videoFileName, setVideoFileName] = useState<string | null>(null)
  const [isPlaying, setIsPlaying]     = useState(false)
  const [progress, setProgress]       = useState(0)   // 0–1
  const [duration, setDuration]       = useState(0)

  const exDef = EXERCISES[exercise]

  // ── Load MediaPipe ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { PoseLandmarker, FilesetResolver } = await import(
          "@mediapipe/tasks-vision"
        )
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

  // ── Shared detection loop ─────────────────────────────────────────────────
  const runDetection = useCallback(() => {
    const def = EXERCISES[exercise]

    function detect() {
      rafRef.current = requestAnimationFrame(detect)

      const video  = videoRef.current
      const canvas = canvasRef.current
      const lm     = landmarkerRef.current

      if (!video || !canvas || !lm || video.readyState < 2) return

      // For uploaded video: skip frames while paused
      if (mode === "video" && video.paused) return

      // Timestamp: live uses performance.now(), video uses currentTime * 1000
      const ts = mode === "camera" ? performance.now() : video.currentTime * 1000
      if (ts <= lastTsRef.current) return
      lastTsRef.current = ts

      // Track video progress
      if (mode === "video" && video.duration) {
        setProgress(video.currentTime / video.duration)
      }

      canvas.width  = video.videoWidth
      canvas.height = video.videoHeight

      const result = lm.detectForVideo(video, ts)
      const ctx    = canvas.getContext("2d")!
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      if (!result.landmarks || result.landmarks.length === 0) {
        setFeedback("No pose detected — make sure your full body is visible")
        return
      }

      const landmarks = result.landmarks[0]
      const W = canvas.width
      const H = canvas.height

      // Mirror only for live camera (selfie mode)
      const transform = (pt: { x: number; y: number; z: number }) =>
        mode === "camera" ? { ...pt, x: 1 - pt.x } : pt

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

      // Draw joints
      for (let i = 0; i < landmarks.length; i++) {
        const pt    = transform(landmarks[i])
        const isKey = def.landmarks.includes(i)
        ctx.beginPath()
        ctx.arc(pt.x * W, pt.y * H, isKey ? 8 : 4, 0, Math.PI * 2)
        ctx.fillStyle = isKey ? "#a855f7" : "rgba(255,255,255,0.7)"
        ctx.fill()
      }

      // Angle at the three key landmarks
      const [li, mi, ri] = def.landmarks
      const a = transform(landmarks[li])
      const b = transform(landmarks[mi])
      const c = transform(landmarks[ri])
      const angle = calcAngle(a, b, c)
      setCurrentAngle(Math.round(angle))

      // Draw angle label
      ctx.fillStyle = "#ffffff"
      ctx.font = "bold 20px sans-serif"
      ctx.fillText(`${Math.round(angle)}°`, b.x * W + 12, b.y * H - 8)

      // Rep counting
      let newStage = stageRef.current
      if (def.downCondition(angle) && stageRef.current !== "down") newStage = "down"
      if (def.upCondition(angle) && stageRef.current === "down") {
        newStage = "up"
        repsRef.current += 1
        setReps(repsRef.current)
      }
      if (def.downCondition(angle) && stageRef.current === "up") newStage = "down"
      if (newStage !== stageRef.current) {
        stageRef.current = newStage
        setStage(newStage)
      }

      if (stageRef.current === "down") setFeedback("Good position!")
      else if (stageRef.current === "up") setFeedback("Rep complete! Return to start.")
      else setFeedback("Get into starting position")
    }

    rafRef.current = requestAnimationFrame(detect)
  }, [exercise, mode])

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
      resetReps()
      setIsRunning(true)
    } catch {
      setError("Camera access denied. Please allow camera permissions.")
    } finally {
      setLoading(false)
    }
  }, [])

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
  }, [])

  // ── Video upload mode ─────────────────────────────────────────────────────
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Revoke previous object URL
    if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)

    const url = URL.createObjectURL(file)
    videoUrlRef.current = url
    setVideoFileName(file.name)

    const video = videoRef.current!
    video.srcObject = null
    video.src = url
    video.load()
    video.onloadedmetadata = () => setDuration(video.duration)

    resetReps()
    setIsRunning(true)
    setIsPlaying(false)
    lastTsRef.current = -1
  }, [])

  const togglePlayPause = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      video.play()
      setIsPlaying(true)
    } else {
      video.pause()
      setIsPlaying(false)
    }
  }, [])

  const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current
    if (!video || !duration) return
    const t = Number(e.target.value) * duration
    video.currentTime = t
    lastTsRef.current = t * 1000 - 1
    setProgress(Number(e.target.value))
  }, [duration])

  // When video ends
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onEnded = () => { setIsPlaying(false); setProgress(1) }
    video.addEventListener("ended", onEnded)
    return () => video.removeEventListener("ended", onEnded)
  }, [])

  // ── Start/stop detection loop when isRunning changes ─────────────────────
  useEffect(() => {
    if (!isRunning) return
    runDetection()
    return () => cancelAnimationFrame(rafRef.current)
  }, [isRunning, runDetection])

  // ── Switch mode: tear everything down ─────────────────────────────────────
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
    resetReps()
    setMode(newMode)
  }, [])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current)
    }
  }, [])

  function resetReps() {
    repsRef.current = 0
    stageRef.current = "ready"
    setReps(0)
    setStage("ready")
    setFeedback("")
  }

  function fmtTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  const stageColor = {
    ready: "bg-slate-100 text-slate-600",
    down: "bg-amber-100 text-amber-700",
    up: "bg-green-100 text-green-700",
  }[stage]

  const isVideoMode  = mode === "video"
  const isCameraMode = mode === "camera"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">AI Pose Tracker</h1>
        <p className="text-sm text-slate-500 mt-1">
          Real-time posture detection and automatic rep counting
        </p>
      </div>

      {error && (
        <div className="rounded-2xl bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      )}

      {/* Mode toggle */}
      <div className="flex gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 w-fit">
        <button
          onClick={() => switchMode("camera")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
            isCameraMode
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Camera className="h-4 w-4" /> Live Camera
        </button>
        <button
          onClick={() => switchMode("video")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all ${
            isVideoMode
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          }`}
        >
          <Film className="h-4 w-4" /> Upload Video
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left — video area */}
        <div className="lg:col-span-2 space-y-4">

          {/* Exercise selector */}
          <div className="flex flex-wrap gap-2">
            {Object.entries(EXERCISES).map(([key, def]) => (
              <button
                key={key}
                onClick={() => { setExercise(key); resetReps() }}
                disabled={isRunning && isCameraMode}
                className={`flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-medium transition-all disabled:opacity-50 ${
                  exercise === key
                    ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white border-transparent shadow-lg"
                    : "bg-white text-slate-700 border-slate-200 hover:border-purple-300"
                }`}
              >
                <span>{def.icon}</span>
                {def.name}
              </button>
            ))}
          </div>

          {/* Hint row */}
          <div className="flex items-center gap-2 rounded-2xl bg-blue-50 border border-blue-100 px-4 py-2 text-xs text-blue-700">
            <Info className="h-3.5 w-3.5 shrink-0" />
            {isVideoMode
              ? "Upload a video of your workout — pose will be analysed automatically as it plays"
              : exDef.cameraHint}
          </div>

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

            {/* Empty state overlay */}
            {!isRunning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/80">
                {isVideoMode ? (
                  <>
                    <Film className="h-12 w-12 text-slate-400" />
                    <p className="text-slate-300 text-sm">No video loaded</p>
                  </>
                ) : (
                  <>
                    <Camera className="h-12 w-12 text-slate-400" />
                    <p className="text-slate-300 text-sm">Camera off</p>
                  </>
                )}
              </div>
            )}

            {/* Feedback overlay */}
            {isRunning && feedback && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-2xl bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-sm whitespace-nowrap">
                {feedback}
              </div>
            )}
          </div>

          {/* ── Camera controls ── */}
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
                    <><Camera className="h-4 w-4" /> Start Camera</>
                  )}
                </button>
              ) : (
                <button
                  onClick={stopCamera}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-800 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-all"
                >
                  <CameraOff className="h-4 w-4" /> Stop Camera
                </button>
              )}
              <button
                onClick={resetReps}
                className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all"
                title="Reset reps"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ── Video upload controls ── */}
          {isVideoMode && (
            <div className="space-y-3">
              {/* Upload button */}
              <div className="flex gap-3">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-500 py-3 text-sm font-semibold text-white shadow-lg hover:opacity-90 transition-all"
                >
                  <Upload className="h-4 w-4" />
                  {videoFileName ? "Change Video" : "Upload Video"}
                </button>
                <button
                  onClick={resetReps}
                  className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition-all"
                  title="Reset reps"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleFileChange}
              />

              {/* File name */}
              {videoFileName && (
                <p className="text-xs text-slate-500 truncate px-1">
                  📁 {videoFileName}
                </p>
              )}

              {/* Playback controls */}
              {isRunning && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                  {/* Progress bar */}
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-400 w-10 shrink-0">
                      {fmtTime((videoRef.current?.currentTime) ?? 0)}
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.001}
                      value={progress}
                      onChange={handleSeek}
                      className="flex-1 accent-purple-600"
                    />
                    <span className="text-xs text-slate-400 w-10 shrink-0 text-right">
                      {fmtTime(duration)}
                    </span>
                  </div>

                  {/* Play / Pause */}
                  <div className="flex items-center justify-center gap-4">
                    <button
                      onClick={togglePlayPause}
                      className="flex items-center gap-2 rounded-xl bg-purple-600 px-6 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition-all"
                    >
                      {isPlaying
                        ? <><Pause className="h-4 w-4" /> Pause</>
                        : <><Play className="h-4 w-4" /> Play</>}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right — Stats */}
        <div className="space-y-4">
          {/* Rep counter */}
          <div className="rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Reps</p>
            <p className="mt-2 text-7xl font-extrabold text-slate-900">{reps}</p>
            <span className={`mt-3 inline-block rounded-full px-3 py-1 text-xs font-semibold ${stageColor}`}>
              {stage === "ready" ? "Ready" : stage === "down" ? "Down ↓" : "Up ↑"}
            </span>
          </div>

          {/* Current angle */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1">
              Joint Angle
            </p>
            {currentAngle !== null ? (
              <>
                <p className="text-4xl font-bold text-slate-900">{currentAngle}°</p>
                <div className="mt-3 h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-500 to-cyan-500 transition-all duration-100"
                    style={{ width: `${Math.min((currentAngle / 180) * 100, 100)}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-xs text-slate-400">
                  <span>0°</span><span>180°</span>
                </div>
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

          {/* How it works */}
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-xs font-semibold text-slate-500 mb-3">
              {isVideoMode ? "How video analysis works" : "How reps are counted"}
            </p>
            <ol className="space-y-2 text-xs text-slate-600">
              {isVideoMode ? (
                <>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">1</span>
                    Upload a workout video
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">2</span>
                    Select the exercise type
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">3</span>
                    Press Play — reps are counted automatically
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">4</span>
                    Scrub through to recheck any part of the video
                  </li>
                </>
              ) : (
                <>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">1</span>
                    Get into starting position
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">2</span>
                    Move through the full range of motion
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-purple-600 text-[10px] font-bold text-white">3</span>
                    Rep is counted automatically at the top
                  </li>
                </>
              )}
            </ol>
          </div>
        </div>
      </div>
    </div>
  )
}
