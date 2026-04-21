import Link from "next/link"

interface SharedStats {
  username: string
  streak: number
  workouts_this_month: number
  avg_daily_calories: number
  goal: string | null
}

async function getSharedStats(token: string): Promise<SharedStats | null> {
  try {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")

    const res = await fetch(`${baseUrl}/api/share?token=${encodeURIComponent(token)}`, {
      cache: "no-store",
    })

    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export default async function SharedProfilePage({
  params,
}: {
  params: { token: string }
}) {
  const data = await getSharedStats(params.token)

  if (!data) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-6xl">🔍</div>
          <h1 className="text-2xl font-bold text-white">Profile not found</h1>
          <p className="text-slate-400">
            This share link is invalid or has expired.
          </p>
          <Link
            href="/"
            className="inline-block mt-4 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-3 font-semibold text-white shadow-lg hover:opacity-90 transition"
          >
            Go to FitFusion AI →
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950 to-slate-950 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-6">
        {/* App header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 rounded-2xl bg-white/10 backdrop-blur px-4 py-2">
            <span className="text-2xl">💪</span>
            <span className="text-lg font-bold text-white tracking-tight">FitFusion AI</span>
          </div>
          <p className="text-slate-400 text-sm">Accountability Partner</p>
        </div>

        {/* Main stats card */}
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-2xl space-y-6">
          {/* User info */}
          <div className="text-center space-y-3">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-purple-500 to-cyan-500 flex items-center justify-center mx-auto shadow-lg">
              <span className="text-3xl font-bold text-white">
                {data.username.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{data.username}</h1>
              {data.goal && (
                <span className="inline-block mt-1 rounded-full bg-purple-500/20 border border-purple-500/30 px-3 py-1 text-xs font-medium text-purple-300">
                  Goal: {data.goal}
                </span>
              )}
            </div>
          </div>

          {/* Streak badge */}
          <div className="flex justify-center">
            <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/30 px-5 py-3">
              <span className="text-2xl">🔥</span>
              <div>
                <p className="text-2xl font-bold text-white leading-none">
                  {data.streak}-day streak
                </p>
                <p className="text-xs text-orange-300 mt-0.5">Consistency is key</p>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              icon="🏋️"
              value={data.workouts_this_month.toString()}
              label="Workouts this month"
              accent="purple"
            />
            <StatTile
              icon="🥗"
              value={
                data.avg_daily_calories > 0
                  ? `${data.avg_daily_calories.toLocaleString()} kcal`
                  : "—"
              }
              label="Avg daily calories"
              accent="cyan"
            />
          </div>

          {/* Divider */}
          <div className="border-t border-white/10" />

          {/* CTA */}
          <div className="text-center space-y-3">
            <p className="text-sm text-slate-400">
              Inspired by {data.username}&apos;s progress?
            </p>
            <Link
              href="/"
              className="block w-full rounded-xl bg-gradient-to-r from-purple-600 to-cyan-500 px-6 py-3.5 font-semibold text-white shadow-lg hover:opacity-90 transition text-center"
            >
              Start your own fitness journey →
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600">
          Powered by FitFusion AI · Your AI Fitness Coach
        </p>
      </div>
    </div>
  )
}

function StatTile({
  icon,
  value,
  label,
  accent,
}: {
  icon: string
  value: string
  label: string
  accent: "purple" | "cyan"
}) {
  const accentClass =
    accent === "purple"
      ? "bg-purple-500/10 border-purple-500/20"
      : "bg-cyan-500/10 border-cyan-500/20"

  return (
    <div className={`rounded-2xl border p-4 ${accentClass} text-center space-y-1`}>
      <div className="text-2xl">{icon}</div>
      <p className="text-xl font-bold text-white leading-tight">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  )
}
