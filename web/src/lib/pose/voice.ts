// Thin wrapper around the Web Speech API. Throttles utterances so the coach
// doesn't spam the user, and avoids overlapping speech.

type Priority = "rep" | "correction" | "encourage" | "warning"

type QueueItem = {
  text: string
  priority: Priority
  at: number
}

export class VoiceCoach {
  private enabled = true
  private queue: QueueItem[] = []
  private lastSpokenAt = 0
  private lastCorrectionAt: Record<string, number> = {}
  private speaking = false
  private voice: SpeechSynthesisVoice | null = null
  private rate = 1.1

  constructor() {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      const pick = () => {
        const voices = window.speechSynthesis.getVoices()
        this.voice =
          voices.find((v) => /en-US|en_GB|en-GB/i.test(v.lang) && /female|samantha|google/i.test(v.name)) ||
          voices.find((v) => /en/i.test(v.lang)) ||
          voices[0] ||
          null
      }
      pick()
      window.speechSynthesis.onvoiceschanged = pick
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on
    if (!on && typeof window !== "undefined") {
      window.speechSynthesis.cancel()
      this.queue = []
      this.speaking = false
    }
  }

  isEnabled() {
    return this.enabled
  }

  // Announce a completed rep; also accepts an optional cue ("Great depth!").
  sayRep(count: number, cue?: string) {
    const text = cue ? `${count}. ${cue}` : `${count}`
    this.enqueue(text, "rep")
  }

  // Throttled correction: same error won't re-speak for `cooldownMs`.
  sayCorrection(id: string, message: string, cooldownMs = 6000) {
    const last = this.lastCorrectionAt[id] ?? 0
    if (Date.now() - last < cooldownMs) return
    this.lastCorrectionAt[id] = Date.now()
    this.enqueue(message, "correction")
  }

  sayEncourage(text: string) {
    this.enqueue(text, "encourage")
  }

  sayWarning(text: string) {
    this.enqueue(text, "warning")
  }

  private enqueue(text: string, priority: Priority) {
    if (!this.enabled) return
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return

    // Drop if queue has 2+ items of same priority already (avoid backlog).
    const samePriorityCount = this.queue.filter((i) => i.priority === priority).length
    if (samePriorityCount >= 2) return

    this.queue.push({ text, priority, at: Date.now() })
    this.drain()
  }

  private drain() {
    if (this.speaking) return
    const next = this.queue.shift()
    if (!next) return

    // Drop stale items (>3s old) — they're no longer useful.
    if (Date.now() - next.at > 3000) {
      this.drain()
      return
    }

    this.speaking = true
    const u = new SpeechSynthesisUtterance(next.text)
    if (this.voice) u.voice = this.voice
    u.rate = this.rate
    u.pitch = 1
    u.onend = () => {
      this.speaking = false
      this.lastSpokenAt = Date.now()
      this.drain()
    }
    u.onerror = () => {
      this.speaking = false
      this.drain()
    }
    window.speechSynthesis.speak(u)
  }

  reset() {
    if (typeof window !== "undefined") window.speechSynthesis.cancel()
    this.queue = []
    this.speaking = false
    this.lastCorrectionAt = {}
  }
}
