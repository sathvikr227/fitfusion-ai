import type { Landmarks, Point } from "./types"

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13,    R_ELBOW: 14,
  L_WRIST: 15,    R_WRIST: 16,
  L_HIP: 23,      R_HIP: 24,
  L_KNEE: 25,     R_KNEE: 26,
  L_ANKLE: 27,    R_ANKLE: 28,
  L_HEEL: 29,     R_HEEL: 30,
  L_FOOT: 31,     R_FOOT: 32,
} as const

export function calcAngle(a: Point, b: Point, c: Point): number {
  const rad = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x)
  let deg = Math.abs((rad * 180) / Math.PI)
  if (deg > 180) deg = 360 - deg
  return deg
}

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

// Visibility threshold: MediaPipe reports 0-1; below this we treat the joint as hidden.
export const VIS_THRESHOLD = 0.4

export function isVisible(p?: Point): boolean {
  if (!p) return false
  if (p.visibility == null) return true
  return p.visibility >= VIS_THRESHOLD
}

export function allVisible(lm: Landmarks, idx: number[]): boolean {
  return idx.every((i) => isVisible(lm[i]))
}

// Midpoint of two landmarks — useful for hip/shoulder centre lines.
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

// Angle a line makes with the horizontal (in degrees).
// Useful for detecting "is the torso horizontal" (push-up) or vertical (squat).
export function lineAngleFromHorizontal(a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const deg = Math.abs((Math.atan2(dy, dx) * 180) / Math.PI)
  return deg > 90 ? 180 - deg : deg
}
