// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

type UserPreferences = {
  conditions: string[]
  allergies: string[]
  diet_type: string
}

const COUNTRY_STATUS_VALUES = ["permitted", "permitted_with_limits", "banned", "under_review", "no_data"]

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "Gemini API key is not configured on the server." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const authHeader = req.headers.get("authorization")
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? ""
    )

    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authHeader.replace("Bearer ", ""))
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } })
    }

    const { ingredientText, preferences } = (await req.json()) as {
      ingredientText?: string
      preferences?: UserPreferences
    }

    if (!ingredientText || typeof ingredientText !== "string") {
      return new Response(JSON.stringify({ error: "ingredientText is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    // Real ingredient labels are rarely more than a few hundred characters.
    // Cap generously above that to block abuse (huge payloads run up Gemini
    // costs and can blow past its context window) without risking false
    // rejections of legitimate long labels.
    const MAX_INPUT_LENGTH = 15000
    if (ingredientText.length > MAX_INPUT_LENGTH) {
      return new Response(
        JSON.stringify({ error: `ingredientText exceeds maximum length of ${MAX_INPUT_LENGTH} characters` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    const cleanedInput = ingredientText
      .replace(/\n/g, ", ")
      .replace(/[^\w\s,.()\-\/]/g, "")
      .replace(/\s+/g, " ")
      .trim()

    // Keep the model grounded to the exact ingredient text supplied by the
    // scanner. The model may explain an ingredient, but it must not invent
    // component ingredients (for example "sodium" from "sodium citrate").
    const sourceIngredients = cleanedInput
      .split(",")
      .map(item => item.trim())
      .filter(item => item.length > 1)

    const ALLOWED_CONDITIONS = ["diabetes", "hypertension", "celiac", "kidney_disease", "heart_disease", "pregnancy", "ibs", "liver_disease"]
    const ALLOWED_ALLERGIES = ["gluten", "dairy", "nuts", "peanuts", "soy", "eggs", "shellfish", "fish", "sulphites", "sesame"]
    const ALLOWED_DIET_TYPES = ["none", "vegan", "vegetarian", "keto", "paleo", "halal", "kosher"]

    let safeConditions: string[] = []
    let safeAllergies: string[] = []
    let safeDietType = "none"

    if (preferences) {
      if (Array.isArray(preferences.conditions)) {
        safeConditions = preferences.conditions.filter(c => ALLOWED_CONDITIONS.includes(c))
      }
      if (Array.isArray(preferences.allergies)) {
        safeAllergies = preferences.allergies.filter(a => ALLOWED_ALLERGIES.includes(a))
      }
      if (preferences.diet_type && ALLOWED_DIET_TYPES.includes(preferences.diet_type)) {
        safeDietType = preferences.diet_type
      }
    }

    const preferencesContext =
      (safeConditions.length > 0 || safeAllergies.length > 0 || safeDietType !== "none")
        ? `
User health context (flag ingredients relevant to these):
- Health conditions: ${safeConditions.length > 0 ? safeConditions.join(", ") : "none"}
- Allergies: ${safeAllergies.length > 0 ? safeAllergies.join(", ") : "none"}
- Diet type: ${safeDietType !== "none" ? safeDietType : "no specific diet"}
`
        : ""

    const prompt = `You are an ingredient safety expert and food scientist. Analyze these product ingredients and return a JSON array. Return ONLY valid JSON — no preamble, no markdown, no backticks, no explanations. Your response must start with [ and end with ].
${preferencesContext}
For each ingredient provide:
- name: string — MUST refer to one complete ingredient from the supplied input. Do not split compounds into component words. For example, if the input contains "sodium citrate", return "sodium citrate", never "sodium". If the input contains "soy lecithin", return "soy lecithin", never "soy".
- aliases: string[] (E-numbers, alternative names)
- category: string (e.g. "Preservative", "Artificial Colour", "Sweetener")
- description: string (2-3 sentences)
- safety_level: "safe" | "caution" | "harmful" | "unknown"
- health_concerns: string[] (empty array if none)
- country_status: object with keys: US, EU, UK, India, Australia, Canada, Japan, China
  Values must be one of: "permitted", "permitted_with_limits", "banned", "under_review", "no_data"
- personal_flag: string | null (only if this ingredient is relevant to the user's health conditions or allergies — explain why briefly, otherwise null)

Ingredients to analyze (these are the only ingredients you may analyze):
${sourceIngredients.map((item, index) => `${index + 1}. ${item}`).join("\n")}

Do not add ingredients that are not explicitly represented by one of the items above. Return one result per analyzable input item.`

    const parsed = await callGemini(prompt)
    const grounded = filterAnalysisToSource(parsed, sourceIngredients)

    return new Response(JSON.stringify(grounded), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error"
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }
})

async function callGemini(prompt: string, retryCount = 0): Promise<unknown[]> {
  let response: Response
  try {
    response = await fetch(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 8192,
          // Structured output: Gemini is constrained to emit exactly this
          // shape, so no output tokens are spent on markdown/backticks and
          // we get a reliability guarantee instead of relying on the regex
          // fallback below. Cuts both latency and parse-failure risk.
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                aliases: { type: "ARRAY", items: { type: "STRING" } },
                category: { type: "STRING" },
                description: { type: "STRING" },
                safety_level: { type: "STRING", enum: ["safe", "caution", "harmful", "unknown"] },
                health_concerns: { type: "ARRAY", items: { type: "STRING" } },
                country_status: {
                  type: "OBJECT",
                  properties: {
                    US: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    EU: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    UK: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    India: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    Australia: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    Canada: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    Japan: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                    China: { type: "STRING", enum: COUNTRY_STATUS_VALUES },
                  },
                  required: ["US", "EU", "UK", "India", "Australia", "Canada", "Japan", "China"],
                },
                personal_flag: { type: "STRING", nullable: true },
              },
              required: ["name", "aliases", "category", "description", "safety_level", "health_concerns", "country_status"],
            },
          },
        },
      }),
    })
  } catch (fetchError) {
    throw new Error(`Network error reaching Gemini: ${(fetchError as Error).message}`)
  }

  // Rate limit — retry with backoff. This only delays a background chunk now
  // (the user is already on the results screen with a "still analyzing"
  // indicator, not blocked on a foreground timeout), but shorter retries
  // still mean ingredients show up faster and less of the free-tier quota
  // sits idle waiting.
  if (response.status === 429 && retryCount < 2) {
    const delay = (retryCount + 1) * 1500
    await new Promise((resolve) => setTimeout(resolve, delay))
    return callGemini(prompt, retryCount + 1)
  }

  const rawText = await response.text()

  if (!response.ok) {
    let errorMessage = `Gemini API error ${response.status}`
    try {
      const errorData = JSON.parse(rawText)
      errorMessage = errorData?.error?.message || errorMessage
    } catch {
      // not JSON — keep default message
    }
    throw new Error(errorMessage)
  }

  let data: any
  try {
    data = JSON.parse(rawText)
  } catch {
    throw new Error("Failed to parse Gemini response")
  }

  const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (!textContent) throw new Error("No response from Gemini")

  // With responseMimeType: "application/json" + responseSchema, Gemini is
  // contractually constrained to return exactly this shape — no markdown
  // fences, no preamble. A direct parse is the primary path; the bracket
  // extraction is only a defensive fallback in case of a transient API quirk.
  try {
    const result = JSON.parse(textContent)
    if (!Array.isArray(result)) throw new Error("Gemini returned unexpected format")
    return result
  } catch {
    const start = textContent.indexOf("[")
    const end = textContent.lastIndexOf("]")
    if (start !== -1 && end !== -1 && end > start) {
      const result = JSON.parse(textContent.substring(start, end + 1))
      if (!Array.isArray(result)) throw new Error("Gemini returned unexpected format")
      return result
    }
    throw new Error("Failed to parse ingredient analysis from Gemini")
  }
}

function normalizeIngredientName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Keep Gemini output grounded in the actual scanner text.
 *
 * Exact matches are preferred. A shortened name is accepted only when it is
 * the leading name of a single source item, such as:
 *   "calcium caseinate" -> "calcium caseinate (milk, ...)"
 *
 * We intentionally reject partial matches like:
 *   "sodium" -> "sodium citrate"
 * because the label contains multiple different sodium compounds and the
 * shorter term is not itself an ingredient on the label.
 */
function filterAnalysisToSource(
  analysis: unknown[],
  sourceIngredients: string[],
): unknown[] {
  const sources = sourceIngredients
    .map((source) => ({
      raw: source,
      normalized: normalizeIngredientName(source),
    }))
    .filter((source) => source.normalized.length > 1)

  return analysis.filter((item) => {
    if (!item || typeof item !== "object") return false

    const name = typeof (item as { name?: unknown }).name === "string"
      ? (item as { name: string }).name
      : ""
    const normalizedName = normalizeIngredientName(name)
    if (!normalizedName) return false

    const matches = sources.filter((source) => {
      if (source.normalized === normalizedName) return true

      // Allow a model to omit a parenthetical qualifier while preserving the
      // complete main ingredient name.
      return source.normalized.startsWith(normalizedName + " ")
        && source.raw.trim().startsWith(name.trim())
        && source.raw.trim().slice(name.trim().length).startsWith("(")
    })

    return matches.length === 1
  })
}
