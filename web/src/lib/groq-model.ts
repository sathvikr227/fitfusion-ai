// Single source of truth for which Groq model the app calls.
//
// Groq retires hosted models without much notice — `llama-3.3-70b-versatile`
// was removed and every AI route started returning
// `404 model_not_found`, because the name was hardcoded in fourteen places.
// Keeping it here means the next retirement is one edit, or no edit at all if
// GROQ_MODEL is set in the environment.
//
// Check what your account can actually use:
//   curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"

/** General chat + JSON generation. Override with GROQ_MODEL. */
export const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b"

/**
 * Smaller, faster model for short latency-sensitive calls (voice replies, quick
 * parses). Override with GROQ_FAST_MODEL. Falls back to the main model so a
 * single override still works everywhere.
 */
export const GROQ_FAST_MODEL =
  process.env.GROQ_FAST_MODEL ?? process.env.GROQ_MODEL ?? "openai/gpt-oss-20b"
