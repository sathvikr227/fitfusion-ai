export type Point = { x: number; y: number; z?: number; visibility?: number }
export type Landmarks = Point[]

export type Side = "left" | "right"

export type ValidatorResult = { ok: boolean; reason?: string }

// A validator confirms the user is actually doing the SELECTED exercise.
// If it fails at the top of a rep, the rep is rejected.
export type Validator = (lm: Landmarks) => ValidatorResult

export type FormCheckResult =
  | { ok: true }
  | { ok: false; message: string; severity: "minor" | "major" }

// Form check runs per-frame during a rep and returns any form issues.
export type FormCheck = {
  id: string
  label: string
  check: (lm: Landmarks, angle: number) => FormCheckResult
}

export type RepAngleSpec = {
  landmarks: [number, number, number]
  down: (angle: number) => boolean
  up: (angle: number) => boolean
}

export type ExerciseKind = "reps" | "hold"

export type ExerciseDef = {
  id: string
  name: string
  icon: string
  category: "Upper Body" | "Lower Body" | "Full Body" | "Core"
  kind: ExerciseKind
  cameraHint: string
  formTip: string
  repAngle: RepAngleSpec
  validators: Validator[]
  formChecks: FormCheck[]
  idealMinAngle: number
  idealMaxAngle: number
  targetTempoSec?: number // ideal seconds per rep
  minRepDurationSec?: number // reject reps faster than this (likely swinging)
  minRomDegrees?: number // reject reps with insufficient range of motion
}

export type RepRecord = {
  index: number
  minAngle: number
  maxAngle: number
  romPct: number
  durationSec: number
  errors: string[]
}

export type SessionSummary = {
  exerciseId: string
  exerciseName: string
  reps: RepRecord[]
  totalReps: number
  avgTempoSec: number
  avgRomPct: number
  formErrorCounts: Record<string, number>
  rejectedReps: number
  holdSeconds?: number
  startedAt: string
  endedAt: string
}
