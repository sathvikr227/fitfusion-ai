"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import Splash from "../components/layout/Splash"
import { supabase } from "../lib/supabase/client"

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    let mounted = true

    const timer = setTimeout(async () => {
      if (!mounted) return

      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!mounted) return

      if (!user) {
        router.replace("/login")
        return
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("id, onboarding_completed")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile || !profile.onboarding_completed) {
        router.replace("/onboarding")
        return
      }

      const { data: latestPlan } = await supabase
        .from("workout_plans")
        .select("id")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (latestPlan?.id) {
        router.replace("/dashboard/home")
      } else {
        router.replace("/generate")
      }
    }, 2000)

    return () => {
      mounted = false
      clearTimeout(timer)
    }
  }, [router])

  return <Splash />
}