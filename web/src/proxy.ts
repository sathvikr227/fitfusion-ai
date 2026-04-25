import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_API_PATHS = [
  '/api/analyze-food',
  '/api/analyze-food-text',
  '/api/food-db',
  '/api/help/workout',
  '/api/help/recipe',
  '/api/seed-knowledge',
  '/api/share',  // public share stats — no auth needed for GET
]

// In-memory rate limit store (resets on cold start)
// Key: ip:path_prefix, Value: { count, resetAt }
const rateLimitStore = new Map<string, { count: number; resetAt: number }>()

// AI routes get 20 req/min per IP, other API routes get 60 req/min
const AI_PATHS = ['/api/assistant', '/api/chat', '/api/dream-body', '/api/generate-plan', '/api/analyze-inspiration', '/api/adaptive-replan', '/api/voice-chat', '/api/weekly-report']
const AI_LIMIT = 20
const DEFAULT_LIMIT = 60
const WINDOW_MS = 60_000 // 1 minute

function rateLimit(ip: string, path: string): { allowed: boolean; remaining: number } {
  const isAiPath = AI_PATHS.some(p => path.startsWith(p))
  const limit = isAiPath ? AI_LIMIT : DEFAULT_LIMIT
  const key = `${ip}:${isAiPath ? 'ai' : 'api'}`
  const now = Date.now()

  const entry = rateLimitStore.get(key)
  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return { allowed: true, remaining: limit - 1 }
  }

  entry.count++
  if (entry.count > limit) {
    return { allowed: false, remaining: 0 }
  }
  return { allowed: true, remaining: limit - entry.count }
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API route protection
  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.some(p => pathname.startsWith(p))) {
      return NextResponse.next()
    }

    // Rate limiting
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
                request.headers.get('x-real-ip') ??
                'anonymous'
    const { allowed, remaining } = rateLimit(ip, pathname)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': '60', 'X-RateLimit-Remaining': '0' } }
      )
    }

    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const res = NextResponse.next()
    res.headers.set('X-RateLimit-Remaining', String(remaining))
    return res
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/api/:path*'],
}
