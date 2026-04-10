"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import AIPulse from "../components/layout/AIPulse" // Our new modern component
import { supabase } from "../lib/supabase/client"

export default function Home() {
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function checkUser() {
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        router.replace("/login")
        return
      }

      // profiles.id is the PK and equals auth.users.id
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.onboarding_completed) {
        router.replace("/onboarding")
        return
      }

      router.replace("/dashboard")
    }

    checkUser()
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <AIPulse />
    </div>
  )
}