import { Suspense } from "react"
import GeneratePageClient from "./GeneratePageClient"

export const dynamic = "force-dynamic"

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <GeneratePageClient />
    </Suspense>
  )
}