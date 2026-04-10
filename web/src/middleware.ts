import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_API_PATHS = [
  '/api/seed-knowledge',
  '/api/analyze-food',
  '/api/analyze-food-text',
  '/api/food-db',
  '/api/help/workout',
  '/api/help/recipe',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API route protection
  if (pathname.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.some(p => pathname.startsWith(p))) {
      return NextResponse.next()
    }
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }

  // Dashboard route protection — check for Supabase auth cookie
  if (pathname.startsWith('/dashboard')) {
    const cookieNames = request.cookies.getAll().map(c => c.name)
    const hasAuthCookie = cookieNames.some(
      name => name.includes('auth-token') || (name.includes('sb-') && name.includes('-auth'))
    )
    if (!hasAuthCookie) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
}
