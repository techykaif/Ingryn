// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import { filterAnalysisToSource, splitTopLevelIngredients } from "./grounding.ts"

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

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

    const { ingredientText } = (await req.json()) as {
      ingredientText?: string
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
    // scanner. Parenthetical qualifiers remain part of the same ingredient.
    const sourceIngredients = splitTopLevelIngredients(cleanedInput)
      .map((item) => item.trim())
      .filter((item) => item.length > 1)

    // The server owns the global ingredient cache. This prevents a user from
    // burning Gemini quota on ingredients that INGRYN already knows.
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    if (!serviceRoleKey) {
      throw new Error("Server configuration error: missing service role key")
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      serviceRoleKey,
    )

    const cacheRows = await findCachedIngredients(admin, sourceIngredients)
    const unknownIngredients = sourceIngredients.filter(
      (item) => !cacheRows.has(normalizeCacheKey(item)),
    )

    if (unknownIngredients.length === 0) {
      return new Response(JSON.stringify([]), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      })
    }

    if (unknownIngredients.length > 25) {
      return new Response(
        JSON.stringify({
          error: "Too many unknown ingredients in one request.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    const prompt = `You are an ingredient safety expert and food scientist. Analyze these product ingredients and return a JSON array. Return ONLY valid JSON — no preamble, no markdown, no backticks, no explanations. Your response must start with [ and end with ].

This is a shared global ingredient cache. Do not personalize the output to any specific user. Do not generate country-specific regulatory status. Do not generate personal flags.

For each ingredient provide:
- name: string — MUST refer to one complete ingredient from the supplied input. Never split a compound into component words.
- aliases: string[] (E-numbers, alternative names)
- category: string
- description: string (2-3 sentences)
- safety_level: "safe" | "caution" | "harmful" | "unknown"
- health_concerns: string[] (empty array if none)

Ingredients to analyze (these are the only ingredients you may analyze):
${unknownIngredients.map((item, index) => `${index + 1}. ${item}`).join("\\n")}

Do not add ingredients that are not explicitly represented above. Return one result per analyzable input item.`

    const parsed = await callGemini(prompt)
    const grounded = filterAnalysisToSource(parsed, unknownIngredients)

    const cached = await persistNewIngredients(
      admin,
      grounded,
      unknownIngredients,
    )

    return new Response(JSON.stringify(cached), {
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

type CachedIngredient = {
  id: string
  name: string
}

function normalizeCacheKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\s+/g, " ")
    .trim()
}

async function findCachedIngredients(
  admin: ReturnType<typeof createClient>,
  sourceIngredients: string[],
): Promise<Map<string, CachedIngredient>> {
  const names = sourceIngredients.map(normalizeCacheKey)

  const { data, error } = await admin
    .from("ingredients")
    .select("id, name")
    .in("name", names)

  if (error) throw error

  return new Map(
    (data ?? []).map((row) => [
      normalizeCacheKey(row.name),
      row as CachedIngredient,
    ]),
  )
}

async function persistNewIngredients(
  admin: ReturnType<typeof createClient>,
  analysis: unknown[],
  sourceIngredients: string[],
): Promise<unknown[]> {
  if (analysis.length === 0) {
    return []
  }

  const allowedSources = new Set(
    sourceIngredients.map(normalizeCacheKey),
  )

  const records = analysis
    .filter((item) => item && typeof item === "object")
    .map((item) => item as Record<string, unknown>)
    .filter((item) =>
      typeof item.name === "string" &&
      allowedSources.has(normalizeCacheKey(item.name))
    )
    .map((item) => ({
      name: normalizeCacheKey(String(item.name)),
      aliases: Array.isArray(item.aliases)
        ? item.aliases.filter((value): value is string => typeof value === "string").slice(0, 20).map((value) => value.slice(0, 200))
        : [],
      category: typeof item.category === "string" ? item.category.slice(0, 120) : "Unknown",
      description: typeof item.description === "string" ? item.description.slice(0, 2000) : "",
      safety_level:
        item.safety_level === "safe" ||
        item.safety_level === "caution" ||
        item.safety_level === "harmful" ||
        item.safety_level === "unknown"
          ? item.safety_level
          : "unknown",
      health_concerns: Array.isArray(item.health_concerns)
        ? item.health_concerns.filter((value): value is string => typeof value === "string").slice(0, 20).map((value) => value.slice(0, 300))
        : [],
    }))

  if (records.length === 0) {
    return []
  }

  const uniqueRecords = Array.from(
    new Map(records.map((record) => [record.name, record])).values(),
  )

  const { error: insertError } = await admin
    .from("ingredients")
    .insert(uniqueRecords)

  if (
    insertError &&
    insertError.code !== "23505"
  ) {
    throw insertError
  }

  const byName = await findCachedIngredients(
    admin,
    uniqueRecords.map((record) => record.name),
  )

  return uniqueRecords
    .map((record) => {
      const id = byName.get(normalizeCacheKey(record.name))?.id
      return id ? { ...record, id } : null
    })
    .filter(Boolean)
}

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
              },
              required: ["name", "aliases", "category", "description", "safety_level", "health_concerns"],
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

