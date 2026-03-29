"use client"

import { useRouter, usePathname } from "next/navigation"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()

  const navItems = [
    { name: "Home", path: "/dashboard/home", icon: "🏠" },
    { name: "Plan & AI", path: "/dashboard/plan", icon: "🤖" },
    { name: "Progress", path: "/dashboard/progress", icon: "📈" },
    { name: "Analytics", path: "/dashboard/analytics", icon: "📊" },
    { name: "Profile", path: "/dashboard/profile", icon: "⚙️" },
  ]

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50">

      {/* SIDEBAR */}
      <aside className="w-64 bg-white/80 backdrop-blur-xl border-r border-slate-200 p-6 hidden md:flex flex-col justify-between">

        {/* TOP */}
        <div>
          {/* LOGO */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-purple-600 to-cyan-500 flex items-center justify-center text-white font-bold">
              F
            </div>
            <h1 className="text-xl font-semibold text-slate-900">
              FitFusion
            </h1>
          </div>

          {/* NAV */}
          <div className="space-y-2">
            {navItems.map((item) => {
              const active = pathname === item.path

              return (
                <button
                  key={item.path}
                  onClick={() => router.push(item.path)}
                  className={`flex items-center gap-3 w-full px-4 py-3 rounded-xl text-sm font-medium transition
                  
                  ${
                    active
                      ? "bg-gradient-to-r from-purple-600 to-cyan-500 text-white shadow"
                      : "text-slate-700 hover:bg-slate-100"
                  }
                  
                  `}
                >
                  <span className="text-lg">{item.icon}</span>
                  {item.name}
                </button>
              )
            })}
          </div>
        </div>

        {/* BOTTOM */}
        <div className="mt-10">
          <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
            <p className="font-medium">Stay consistent 💪</p>
            <p className="text-xs mt-1">
              Small progress every day leads to big results.
            </p>
          </div>
        </div>
      </aside>

      {/* CONTENT */}
      <main className="flex-1 p-6 md:p-10 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}