import { LM, calcAngle, dist, midpoint } from "./angles"
import type { ExerciseDef, FormCheck, Landmarks, Validator } from "./types"

// ──────────────────────────────────────────────────────────────────────────────
// Validators: confirm the SHAPE of the body matches the selected exercise.
// Each rep only counts if ALL validators pass at the "up" transition.
// ──────────────────────────────────────────────────────────────────────────────

// Torso horizontal (push-up, plank, mountain climber).
// Measures the shoulder→hip line — if it's near-horizontal, the person is prone.
const torsoHorizontal: Validator = (lm) => {
  const sh = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER])
  const hp = midpoint(lm[LM.L_HIP], lm[LM.R_HIP])
  const dx = Math.abs(sh.x - hp.x)
  const dy = Math.abs(sh.y - hp.y)
  if (dx < dy * 0.8) {
    return { ok: false, reason: "Your body isn't horizontal — get into a plank position" }
  }
  return { ok: true }
}

const torsoUpright: Validator = (lm) => {
  const sh = midpoint(lm[LM.L_SHOULDER], lm[LM.R_SHOULDER])
  const hp = midpoint(lm[LM.L_HIP], lm[LM.R_HIP])
  const dx = Math.abs(sh.x - hp.x)
  const dy = Math.abs(sh.y - hp.y)
  if (dy < dx * 0.8) {
    return { ok: false, reason: "Stand upright — your torso should be vertical" }
  }
  return { ok: true }
}

// Wrists finish above shoulders — required for shoulder press (not curl).
const wristsAboveShouldersAtTop: Validator = (lm) => {
  const wristY = Math.min(lm[LM.L_WRIST].y, lm[LM.R_WRIST].y)
  const shoulderY = Math.min(lm[LM.L_SHOULDER].y, lm[LM.R_SHOULDER].y)
  if (wristY > shoulderY - 0.02) {
    return { ok: false, reason: "Wrists must finish above your shoulders — this looks like a curl, not a press" }
  }
  return { ok: true }
}

// Elbow stays close to the torso — for bicep curls (prevents swinging / shoulder press).
const elbowStaysPinned: Validator = (lm) => {
  const elbowToHip = dist(lm[LM.R_ELBOW], lm[LM.R_HIP])
  const shoulderToHip = dist(lm[LM.R_SHOULDER], lm[LM.R_HIP])
  if (elbowToHip > shoulderToHip * 1.15) {
    return { ok: false, reason: "Keep your elbow pinned to your side — don't let it flare out" }
  }
  return { ok: true }
}

// Wrists BELOW shoulders — confirms a curl or row (not a press).
const wristsBelowShoulders: Validator = (lm) => {
  const wristY = (lm[LM.L_WRIST].y + lm[LM.R_WRIST].y) / 2
  const shoulderY = (lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2
  if (wristY < shoulderY) {
    return { ok: false, reason: "Wrists are above shoulders — that looks like a press, not a curl" }
  }
  return { ok: true }
}

// Elbow stays roughly stationary across reps — prevents the whole arm from swinging
// (which is what stretches/casual arm motion look like vs. a clean curl).
const elbowAlignedUnderShoulder: Validator = (lm) => {
  const elbowX = lm[LM.R_ELBOW].x
  const shoulderX = lm[LM.R_SHOULDER].x
  const dx = Math.abs(elbowX - shoulderX)
  if (dx > 0.12) {
    return { ok: false, reason: "Elbow should stay roughly under your shoulder — don't swing it" }
  }
  return { ok: true }
}

// Hip drops below knee for a proper squat.
const hipBelowKneeAtBottom: Validator = (lm) => {
  const hipY = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2
  const kneeY = (lm[LM.L_KNEE].y + lm[LM.R_KNEE].y) / 2
  if (hipY < kneeY - 0.05) {
    return { ok: false, reason: "Squat deeper — hip should reach knee level" }
  }
  return { ok: true }
}

// Both feet on ground for squat/deadlift (ankles below hips).
const feetGrounded: Validator = (lm) => {
  const ankleY = Math.max(lm[LM.L_ANKLE].y, lm[LM.R_ANKLE].y)
  const hipY = (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2
  if (ankleY < hipY) {
    return { ok: false, reason: "Keep both feet on the ground" }
  }
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────────
// Form checks: per-frame quality scoring.
// ──────────────────────────────────────────────────────────────────────────────

const squatFormChecks: FormCheck[] = [
  {
    id: "knee_cave",
    label: "Knees caving inward",
    check: (lm) => {
      const kneeDist = Math.abs(lm[LM.L_KNEE].x - lm[LM.R_KNEE].x)
      const ankleDist = Math.abs(lm[LM.L_ANKLE].x - lm[LM.R_ANKLE].x)
      if (ankleDist > 0.05 && kneeDist < ankleDist * 0.7) {
        return { ok: false, message: "Push your knees out — don't let them cave inward", severity: "major" }
      }
      return { ok: true }
    },
  },
  {
    id: "back_rounding",
    label: "Back rounding",
    check: (lm) => {
      const backAngle = calcAngle(lm[LM.R_SHOULDER], lm[LM.R_HIP], lm[LM.R_KNEE])
      if (backAngle < 60) {
        return { ok: false, message: "Keep your chest up — your back is rounding", severity: "major" }
      }
      return { ok: true }
    },
  },
]

const pushupFormChecks: FormCheck[] = [
  {
    id: "hip_sag",
    label: "Hips sagging",
    check: (lm) => {
      const alignment = calcAngle(lm[LM.R_SHOULDER], lm[LM.R_HIP], lm[LM.R_ANKLE])
      if (alignment < 155) {
        return { ok: false, message: "Keep a straight line — don't sag your hips", severity: "major" }
      }
      return { ok: true }
    },
  },
  {
    id: "shallow",
    label: "Shallow depth",
    check: (_lm, angle) => {
      if (angle > 110) {
        return { ok: false, message: "Go deeper — chest closer to the floor", severity: "minor" }
      }
      return { ok: true }
    },
  },
]

const bicepCurlFormChecks: FormCheck[] = [
  {
    id: "elbow_drift",
    label: "Elbow drifting",
    check: (lm) => {
      const elbowToHip = dist(lm[LM.R_ELBOW], lm[LM.R_HIP])
      const shoulderToHip = dist(lm[LM.R_SHOULDER], lm[LM.R_HIP])
      if (elbowToHip > shoulderToHip * 1.3) {
        return { ok: false, message: "Keep your elbow pinned to your side", severity: "minor" }
      }
      return { ok: true }
    },
  },
]

const shoulderPressFormChecks: FormCheck[] = [
  {
    id: "back_arch",
    label: "Lower back arching",
    check: (lm) => {
      const torsoAngle = calcAngle(lm[LM.R_SHOULDER], lm[LM.R_HIP], lm[LM.R_KNEE])
      if (torsoAngle < 155) {
        return { ok: false, message: "Brace your core — don't arch your lower back", severity: "major" }
      }
      return { ok: true }
    },
  },
]

const lungeFormChecks: FormCheck[] = [
  {
    id: "knee_past_toe",
    label: "Front knee past toe",
    check: (lm) => {
      const kneeX = lm[LM.R_KNEE].x
      const ankleX = lm[LM.R_ANKLE].x
      if (kneeX - ankleX > 0.08) {
        return { ok: false, message: "Don't let your knee go past your toe", severity: "minor" }
      }
      return { ok: true }
    },
  },
]

const plankFormChecks: FormCheck[] = [
  {
    id: "hip_sag",
    label: "Hips sagging",
    check: (lm) => {
      const alignment = calcAngle(lm[LM.R_SHOULDER], lm[LM.R_HIP], lm[LM.R_ANKLE])
      if (alignment < 160) {
        return { ok: false, message: "Straight line — hips up, don't sag", severity: "major" }
      }
      if (alignment > 180) {
        return { ok: false, message: "Lower your hips — don't pike", severity: "minor" }
      }
      return { ok: true }
    },
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// Exercise catalogue
// ──────────────────────────────────────────────────────────────────────────────

export const EXERCISES: Record<string, ExerciseDef> = {
  bicep_curl: {
    id: "bicep_curl",
    name: "Bicep Curl",
    icon: "💪",
    category: "Upper Body",
    kind: "reps",
    cameraHint: "Face camera sideways — show your full arm",
    formTip: "Keep elbow pinned to your side throughout the movement",
    repAngle: {
      landmarks: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
      down: (a) => a > 155,
      up: (a) => a < 45,
    },
    validators: [torsoUpright, elbowStaysPinned, elbowAlignedUnderShoulder, wristsBelowShoulders],
    formChecks: bicepCurlFormChecks,
    idealMinAngle: 30,
    idealMaxAngle: 170,
    targetTempoSec: 2.5,
    minRepDurationSec: 0.8,
    minRomDegrees: 100,
  },

  shoulder_press: {
    id: "shoulder_press",
    name: "Shoulder Press",
    icon: "⬆️",
    category: "Upper Body",
    kind: "reps",
    cameraHint: "Face camera — full upper body visible",
    formTip: "Brace your core — don't arch your lower back",
    repAngle: {
      landmarks: [LM.R_ELBOW, LM.R_SHOULDER, LM.R_HIP],
      down: (a) => a < 70,
      up: (a) => a > 150,
    },
    validators: [torsoUpright, wristsAboveShouldersAtTop],
    formChecks: shoulderPressFormChecks,
    idealMinAngle: 60,
    idealMaxAngle: 170,
    targetTempoSec: 2.5,
  },

  pushup: {
    id: "pushup",
    name: "Push-up",
    icon: "🔄",
    category: "Upper Body",
    kind: "reps",
    cameraHint: "Place camera at floor level, sideways to your body",
    formTip: "Straight line head to heels — no sagging hips",
    repAngle: {
      landmarks: [LM.R_SHOULDER, LM.R_ELBOW, LM.R_WRIST],
      down: (a) => a < 90,
      up: (a) => a > 150,
    },
    validators: [torsoHorizontal],
    formChecks: pushupFormChecks,
    idealMinAngle: 80,
    idealMaxAngle: 170,
    targetTempoSec: 2.0,
  },

  lateral_raise: {
    id: "lateral_raise",
    name: "Lateral Raise",
    icon: "↔️",
    category: "Upper Body",
    kind: "reps",
    cameraHint: "Face the camera directly — both arms visible",
    formTip: "Lead with elbows, stop at shoulder height — don't shrug",
    repAngle: {
      landmarks: [LM.R_HIP, LM.R_SHOULDER, LM.R_ELBOW],
      down: (a) => a < 30,
      up: (a) => a > 75,
    },
    validators: [torsoUpright],
    formChecks: [],
    idealMinAngle: 15,
    idealMaxAngle: 90,
    targetTempoSec: 2.5,
  },

  dumbbell_row: {
    id: "dumbbell_row",
    name: "Dumbbell Row",
    icon: "🚣",
    category: "Upper Body",
    kind: "reps",
    cameraHint: "Camera sideways — brace one hand on a bench",
    formTip: "Keep back flat — drive elbow up and back",
    repAngle: {
      landmarks: [LM.R_HIP, LM.R_SHOULDER, LM.R_ELBOW],
      down: (a) => a > 140,
      up: (a) => a < 65,
    },
    validators: [],
    formChecks: [],
    idealMinAngle: 20,
    idealMaxAngle: 160,
    targetTempoSec: 2.5,
  },

  squat: {
    id: "squat",
    name: "Squat",
    icon: "🏋️",
    category: "Lower Body",
    kind: "reps",
    cameraHint: "Stand sideways to camera — full body visible",
    formTip: "Chest up, knees tracking over toes",
    repAngle: {
      landmarks: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
      down: (a) => a < 100,
      up: (a) => a > 160,
    },
    validators: [torsoUpright, feetGrounded, hipBelowKneeAtBottom],
    formChecks: squatFormChecks,
    idealMinAngle: 70,
    idealMaxAngle: 170,
    targetTempoSec: 3.0,
  },

  lunge: {
    id: "lunge",
    name: "Lunge",
    icon: "🦵",
    category: "Lower Body",
    kind: "reps",
    cameraHint: "Stand sideways to camera — full leg visible",
    formTip: "Front knee above ankle — don't let it cave inward",
    repAngle: {
      landmarks: [LM.R_HIP, LM.R_KNEE, LM.R_ANKLE],
      down: (a) => a < 105,
      up: (a) => a > 160,
    },
    validators: [torsoUpright],
    formChecks: lungeFormChecks,
    idealMinAngle: 80,
    idealMaxAngle: 170,
    targetTempoSec: 3.0,
  },

  deadlift: {
    id: "deadlift",
    name: "Deadlift",
    icon: "🏗️",
    category: "Lower Body",
    kind: "reps",
    cameraHint: "Camera sideways — full body from head to feet",
    formTip: "Drive hips forward — keep bar close, back straight",
    repAngle: {
      landmarks: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE],
      down: (a) => a < 90,
      up: (a) => a > 165,
    },
    validators: [feetGrounded],
    formChecks: [
      {
        id: "back_round",
        label: "Back rounding",
        check: (lm) => {
          const back = calcAngle(lm[LM.R_SHOULDER], lm[LM.R_HIP], lm[LM.R_KNEE])
          if (back < 70) return { ok: false, message: "Straighten your back — don't round it", severity: "major" }
          return { ok: true }
        },
      },
    ],
    idealMinAngle: 70,
    idealMaxAngle: 175,
    targetTempoSec: 3.5,
  },

  glute_bridge: {
    id: "glute_bridge",
    name: "Glute Bridge",
    icon: "🌉",
    category: "Lower Body",
    kind: "reps",
    cameraHint: "Camera sideways — lying on back, knees bent",
    formTip: "Squeeze glutes at the top — ribs down, chin tucked",
    repAngle: {
      landmarks: [LM.R_SHOULDER, LM.R_HIP, LM.R_KNEE],
      down: (a) => a < 120,
      up: (a) => a > 160,
    },
    validators: [],
    formChecks: [],
    idealMinAngle: 110,
    idealMaxAngle: 175,
    targetTempoSec: 2.5,
  },

  calf_raise: {
    id: "calf_raise",
    name: "Calf Raise",
    icon: "🦶",
    category: "Lower Body",
    kind: "reps",
    cameraHint: "Camera sideways at ankle height",
    formTip: "Rise onto the balls of your feet — hold at the top",
    repAngle: {
      landmarks: [LM.R_KNEE, LM.R_ANKLE, LM.R_HEEL],
      down: (a) => a > 90,
      up: (a) => a < 70,
    },
    validators: [torsoUpright],
    formChecks: [],
    idealMinAngle: 50,
    idealMaxAngle: 110,
    targetTempoSec: 1.5,
  },

  jumping_jack: {
    id: "jumping_jack",
    name: "Jumping Jack",
    icon: "🤸",
    category: "Full Body",
    kind: "reps",
    cameraHint: "Face camera — full body with room to jump",
    formTip: "Full range — arms all the way up, feet wide",
    repAngle: {
      // Angle at shoulder measures arm elevation
      landmarks: [LM.R_HIP, LM.R_SHOULDER, LM.R_ELBOW],
      down: (a) => a < 30,
      up: (a) => a > 140,
    },
    validators: [torsoUpright],
    formChecks: [],
    idealMinAngle: 15,
    idealMaxAngle: 170,
    targetTempoSec: 1.0,
  },

  plank: {
    id: "plank",
    name: "Plank (Hold)",
    icon: "🧘",
    category: "Core",
    kind: "hold",
    cameraHint: "Camera sideways at floor level",
    formTip: "Straight line head to heels — brace core and glutes",
    repAngle: {
      landmarks: [LM.R_SHOULDER, LM.R_HIP, LM.R_ANKLE],
      down: (a) => a > 160,
      up: (a) => a > 160,
    },
    validators: [torsoHorizontal],
    formChecks: plankFormChecks,
    idealMinAngle: 160,
    idealMaxAngle: 180,
  },
}

export const EXERCISE_CATEGORIES: Record<string, string[]> = {
  "Upper Body": ["bicep_curl", "shoulder_press", "pushup", "lateral_raise", "dumbbell_row"],
  "Lower Body": ["squat", "lunge", "deadlift", "glute_bridge", "calf_raise"],
  "Full Body":  ["jumping_jack"],
  "Core":       ["plank"],
}

// Run all validators; returns the first failure reason or null.
export function validateExercise(def: ExerciseDef, lm: Landmarks): string | null {
  for (const v of def.validators) {
    const r = v(lm)
    if (!r.ok) return r.reason ?? "Wrong exercise form"
  }
  return null
}

// Run form checks; returns active error messages (deduped).
export function runFormChecks(def: ExerciseDef, lm: Landmarks, angle: number): { id: string; message: string; severity: "minor" | "major" }[] {
  const out: { id: string; message: string; severity: "minor" | "major" }[] = []
  for (const fc of def.formChecks) {
    const r = fc.check(lm, angle)
    if (!r.ok) out.push({ id: fc.id, message: r.message, severity: r.severity })
  }
  return out
}
