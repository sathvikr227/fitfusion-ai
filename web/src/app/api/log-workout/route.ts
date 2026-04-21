import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
  calculateWorkoutCalories,
  estimateCaloriesFromSets,
} from "../../../lib/calories" // ✅ FIXED PATH

export const runtime = "nodejs"

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Supabase env vars missing")
  return createClient(url, key)
}

export async function POST(req: Request) {
  try {
    const supabase = getSupabase()
    const body = await req.json()

    const {
      userId,
      exercises,
      isAssigned,
      planId,
      userWeight,
    } = body

    if (!userId || !exercises || exercises.length === 0) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // Verify the caller is the user they claim to be
    const authHeader = req.headers.get("Authorization")
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const token = authHeader.slice(7)
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !authUser || authUser.id !== userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const today = new Date().toISOString().split("T")[0]

    //////////////////////////////////////////////
    // 🔥 CALCULATE CALORIES
    //////////////////////////////////////////////

    let totalCalories = 0

    const exerciseLogs = exercises.map((ex: any) => {
      let calories = 0

      if (ex.duration) {
        calories = calculateWorkoutCalories(
          userWeight,
          ex.duration,
          ex.name
        )
      } else if (ex.sets) {
        calories = estimateCaloriesFromSets(
          userWeight,
          ex.sets,
          ex.name
        )
      }

      totalCalories += calories

      return {
        exercise_name: ex.name,
        sets: ex.sets || null,
        reps: ex.reps || null,
        weight: ex.weight || null,
        duration: ex.duration || null,
        calories,
      }
    })

    //////////////////////////////////////////////
    // 🧾 INSERT WORKOUT LOG
    //////////////////////////////////////////////

    const { data: workoutLog, error: logError } = await supabase
      .from("workout_logs")
      .insert({
        user_id: userId,
        date: today,
        is_assigned: isAssigned || false,
        plan_id: planId || null,
        total_calories: totalCalories,
      })
      .select()
      .single()

    if (logError || !workoutLog) {
      console.error("Workout log error:", logError)
      return NextResponse.json(
        { error: "Failed to save workout log" },
        { status: 500 }
      )
    }

    //////////////////////////////////////////////
    // 🏋️ INSERT EXERCISE LOGS
    //////////////////////////////////////////////

    const exerciseInsertData = exerciseLogs.map((ex: any) => ({ // ✅ FIXED TYPE
      workout_log_id: workoutLog.id,
      ...ex,
    }))

    const { error: exerciseError } = await supabase
      .from("exercise_logs")
      .insert(exerciseInsertData)

    if (exerciseError) {
      console.error("Exercise log error:", exerciseError)
      return NextResponse.json(
        { error: "Workout saved but exercises failed" },
        { status: 500 }
      )
    }

    //////////////////////////////////////////////
    // ✅ RESPONSE
    //////////////////////////////////////////////

    return NextResponse.json({
      success: true,
      totalCalories,
      exercises: exerciseLogs,
    })
  } catch (error: any) {
    console.error("LOG WORKOUT ERROR:", error)

    return NextResponse.json(
      { error: error.message || "Failed to log workout" },
      { status: 500 }
    )
  }
}