import { NextResponse } from "next/server"
import { createClient, type User } from "@supabase/supabase-js"

// Verifies the caller's Supabase access token. Returns the user, or a 401
// response the route should return as-is. proxy.ts only checks that a Bearer
// header exists; this checks that it belongs to a real, signed-in user.
export async function requireUser(req: Request): Promise<User | NextResponse> {
  const authHeader = req.headers.get("authorization")
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) {
    return NextResponse.json({ error: "Supabase environment variables are missing" }, { status: 500 })
  }

  const token = authHeader.replace("Bearer ", "")
  const { data: { user }, error } = await createClient(url, key).auth.getUser(token)
  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  return user
}
