import { NextResponse } from "next/server"

import { pingMLService, predictCalorie } from "../../../lib/ml-service"

export const runtime = "nodejs"

export async function GET() {
  const ping = await pingMLService()

  const roundTrip = await predictCalorie({
    exercise: "running",
    duration_min: 30,
    weight_kg: 70,
    intensity: "moderate",
  })

  return NextResponse.json({
    healthz: ping,
    roundTrip: {
      ok: !roundTrip.fromFallback,
      fromFallback: roundTrip.fromFallback,
      reason: roundTrip.reason ?? null,
      sample: roundTrip.data,
    },
    env: {
      ML_SERVICE_URL_set: Boolean(process.env.ML_SERVICE_URL),
      ML_SERVICE_API_KEY_set: Boolean(process.env.ML_SERVICE_API_KEY),
    },
  })
}
