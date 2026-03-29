'use client'

export default function Splash() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-gradient-to-br from-white to-blue-50">

      <img
        src="/logo.png"
        alt="FitFusion AI"
        className="w-40 h-40 object-contain animate-pulse"
      />

      <h1 className="mt-6 text-2xl font-semibold bg-gradient-to-r from-purple-600 to-cyan-500 bg-clip-text text-transparent">
        FitFusion AI
      </h1>

    </div>
  )
}