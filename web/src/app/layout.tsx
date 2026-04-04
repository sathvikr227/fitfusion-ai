import './globals.css'
import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'

export const metadata: Metadata = {
  title: {
    default: 'FitFusion AI — Your AI Fitness Companion',
    template: '%s | FitFusion AI',
  },
  description: 'Personalised AI workout plans, nutrition tracking, pose detection, habit analysis, and progress tracking — all in one place.',
  keywords: ['fitness', 'AI', 'workout', 'nutrition', 'health', 'exercise', 'diet', 'pose tracking'],
  authors: [{ name: 'FitFusion AI' }],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'FitFusion AI',
  },
  openGraph: {
    type: 'website',
    title: 'FitFusion AI',
    description: 'Your AI-powered personal fitness companion.',
    siteName: 'FitFusion AI',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/logo.png" />
        <link rel="apple-touch-icon" href="/logo.png" />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
