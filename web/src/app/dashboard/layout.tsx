"use client"

import React from "react"
import { usePathname, useRouter } from "next/navigation"
import {
  LayoutDashboard,
  Bot,
  ClipboardList,
  LineChart,
  CircleHelp,
  UserCog,
  Sparkles,
  Menu,
  X,
} from "lucide-react"
import VoiceAssistant from "../../components/VoiceAssistant"

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = React.useState(false)

  const navItems = [
    { name: "Home", href: "/dashboard/home", icon: LayoutDashboard },
    { name: "Plan & AI", href: "/dashboard/plan", icon: Bot },
    { name: "Progress", href: "/dashboard/progress", icon: ClipboardList },
    { name: "Analytics", href: "/dashboard/analytics", icon: LineChart },
    { name: "Help", href: "/dashboard/help", icon: CircleHelp },
    { name: "Profile", href: "/dashboard/profile", icon: UserCog },
  ]

  const isActive = (href: string) => {
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const NavButton = ({
    href,
    name,
    icon: Icon,
  }: {
    href: string
    name: string
    icon: React.ElementType
  }) => {
    const active = isActive(href)

    return (
      <button
        onClick={() => {
          router.push(href)
          setMobileOpen(false)
        }}
        className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition-all duration-200 ${
          active
            ? "bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/20"
            : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        }`}
      >
        <Icon className="h-5 w-5 shrink-0" />
        <span className="flex-1">{name}</span>
      </button>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-slate-50 to-blue-50 text-slate-900">
      
      {/* MOBILE HEADER */}
      <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur-xl md:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <button
            onClick={() => router.push("/dashboard/home")}
            className="flex items-center gap-3"
          >
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-lg font-bold text-white">
              F
            </div>
            <div className="text-left">
              <h1 className="text-base font-bold">FitFusion</h1>
              <p className="text-[11px] text-slate-500">AI fitness companion</p>
            </div>
          </button>

          <button
            onClick={() => setMobileOpen((v) => !v)}
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {mobileOpen && (
          <div className="border-t border-slate-200 bg-white px-4 py-4">
            <nav className="space-y-2">
              {navItems.map((item) => (
                <NavButton
                  key={item.href}
                  href={item.href}
                  name={item.name}
                  icon={item.icon}
                />
              ))}
            </nav>
          </div>
        )}
      </div>

      <div className="flex min-h-screen">
        
        {/* SIDEBAR */}
        <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white/85 px-5 py-6 backdrop-blur-xl md:flex md:flex-col md:justify-between">
          
          {/* TOP */}
          <div>
            <button
              onClick={() => router.push("/dashboard/home")}
              className="mb-10 flex items-center gap-4 text-left"
            >
              <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-to-r from-purple-600 via-indigo-600 to-cyan-500 text-2xl font-bold text-white">
                F
              </div>
              <div>
                <h1 className="text-2xl font-extrabold">FitFusion</h1>
                <p className="text-sm text-slate-500">AI fitness companion</p>
              </div>
            </button>

            <nav className="space-y-3">
              {navItems.map((item) => (
                <NavButton
                  key={item.href}
                  href={item.href}
                  name={item.name}
                  icon={item.icon}
                />
              ))}
            </nav>
          </div>

          {/* BOTTOM (ONLY MOTIVATION CARD NOW) */}
          <div className="mt-10">
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-600" />
                <p className="font-semibold text-slate-900">Stay consistent</p>
              </div>
              <p className="text-xs text-slate-600">
                Small progress every day leads to big results. Keep logging and
                keep moving.
              </p>
            </div>
          </div>
        </aside>

        {/* CONTENT */}
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-10 md:py-8">
          {children}
        </main>
      </div>

      {/* VOICE ASSISTANT — floating on all dashboard pages */}
      <VoiceAssistant />
    </div>
  )
}