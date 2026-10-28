import type Groq from "groq-sdk"
import { GROQ_MODEL } from "./groq-model"

// JSON-mode Groq calls that survive reasoning models.
//
// gpt-oss models spend hidden reasoning tokens out of max_tokens before any
// visible output. At the default effort that was ~750–950 tokens, so a 600- or
// 1,200-token budget ran out mid-JSON and Groq rejected the reply with
// `400 json_validate_failed` (the grocery list and recipe help failed every
// time). Low effort cuts reasoning to ~10–400 tokens; one retry at double the
// budget covers the rest.

type Message = { role: "system" | "user" | "assistant"; content: string }

/** `reasoning_effort: "low"` for gpt-oss models; other models reject the field. */
export function reasoningOptions(model: string): { reasoning_effort?: "low" } {
  return model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}
}

function isJsonValidateFailed(err: unknown): boolean {
  const e = err as { status?: number; error?: { error?: { code?: string } }; message?: string }
  return e?.status === 400 && (e.error?.error?.code === "json_validate_failed" || /json_validate_failed/.test(String(e.message)))
}

/** Returns the raw JSON text of the reply. Throws if both attempts fail. */
export async function groqJson(
  groq: Groq,
  opts: { messages: Message[]; maxTokens: number; temperature?: number; model?: string }
): Promise<string> {
  const model = opts.model ?? GROQ_MODEL
  const call = (maxTokens: number) =>
    groq.chat.completions.create({
      model,
      messages: opts.messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: maxTokens,
      response_format: { type: "json_object" },
      ...reasoningOptions(model),
    })

  try {
    const completion = await call(opts.maxTokens)
    return completion.choices[0]?.message?.content ?? ""
  } catch (err) {
    if (!isJsonValidateFailed(err)) throw err
    console.warn(`[groq-json] json_validate_failed at ${opts.maxTokens} tokens, retrying at ${opts.maxTokens * 2}`)
    const completion = await call(opts.maxTokens * 2)
    return completion.choices[0]?.message?.content ?? ""
  }
}
