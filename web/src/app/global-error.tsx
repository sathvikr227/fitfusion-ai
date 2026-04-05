"use client"

import { useEffect } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

// Global error boundary — catches errors in the root layout itself.
// Must include <html> and <body> tags.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Global layout error:", error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0f172a", fontFamily: "sans-serif" }}>
          <div style={{ textAlign: "center", maxWidth: 400, padding: "2rem" }}>
            <div style={{ background: "#1e293b", borderRadius: "1.5rem", padding: "1.5rem", display: "inline-flex", marginBottom: "1.5rem" }}>
              <AlertTriangle style={{ width: 40, height: 40, color: "#f87171" }} />
            </div>
            <h1 style={{ color: "#f1f5f9", fontSize: "1.5rem", fontWeight: 700, margin: "0 0 0.5rem" }}>
              Something went wrong
            </h1>
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", margin: "0 0 1.5rem" }}>
              A critical error occurred. Please try again.
            </p>
            <button
              onClick={reset}
              style={{ background: "linear-gradient(to right, #7c3aed, #06b6d4)", color: "#fff", border: "none", borderRadius: "1rem", padding: "0.75rem 1.5rem", fontSize: "0.875rem", fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
            >
              Try Again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
