import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const ANALYZE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/analyze-ingredients`
const CHUNK_SIZE = 20
const MAX_ATTEMPTS = 5

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-scan-worker-token",
}

type ClaimedJob = {
  job_id: string
  scan_id: string
  attempts: number
  ingredient_names: string[]
  ingredient_cursor: number
}

type ScanRow = {
  id: string
  user_id: string
  raw_ocr_text: string | null
  ingredient_ids: string[] | null
}

type CachedIngredient = {
  id: string
  name: string
  safety_level: string
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Worker is not configured" }, 500)
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  if (!(await isValidWorkerRequest(req, admin))) {
    return json({ error: "Unauthorized" }, 401)
  }

  const { data: rawJob, error: claimError } = await admin
    .rpc("claim_scan_analysis_job")
    .maybeSingle()

  const job = rawJob as ClaimedJob | null

  if (claimError) {
    console.error("Failed to claim scan analysis job", claimError)
    return json({ error: "Could not claim analysis job" }, 500)
  }

  if (!job) {
    return json({ processed: false, reason: "no_jobs" })
  }

  try {
    const { data: rawScan, error: scanError } = await admin
      .from("scans")
      .select("id, user_id, raw_ocr_text, ingredient_ids")
      .eq("id", job.scan_id)
      .maybeSingle()

    if (scanError) throw scanError

    const scan = rawScan as ScanRow | null

    if (!scan) {
      await markJobComplete(admin, job.job_id)
      return json({ processed: true, scanId: job.scan_id, reason: "scan_missing" })
    }

    await admin
      .from("scans")
      .update({
        analysis_status: "processing",
        analysis_error: null,
        analysis_updated_at: new Date().toISOString(),
      })
      .eq("id", typedScan.id)

    const sourceIngredients = parseIngredientNames(typedScan.raw_ocr_text ?? "")
    if (sourceIngredients.length === 0) {
      await admin
        .from("scans")
        .update({
          analysis_status: "failed",
          analysis_error: "No ingredients could be identified.",
          analysis_updated_at: new Date().toISOString(),
        })
        .eq("id", typedScan.id)

      await markJobFailed(admin, job.job_id, job.attempts, "No ingredients could be identified.")
      return json({ processed: true, scanId: typedScan.id, status: "failed" })
    }

    let ingredientNames = job.ingredient_names
    let cursor = job.ingredient_cursor

    // The first worker pass determines the exact unresolved names from the
    // database, then stores them in the durable job. This means a killed app
    // does not lose the analysis workload.
    if (ingredientNames.length === 0) {
      const initialCache = await findCachedIngredients(admin, sourceIngredients)
      ingredientNames = sourceIngredients.filter(
        (name) => !initialCache.has(normalizeCacheKey(name)),
      )

      if (ingredientNames.length === 0) {
        await syncScanFromCache(admin, typedScan, initialCache, sourceIngredients)
        await markJobComplete(admin, job.job_id)
        return json({ processed: true, scanId: typedScan.id, status: "completed" })
      }

      cursor = 0
      const { error: jobStateError } = await admin
        .from("scan_analysis_jobs")
        .update({
          ingredient_names: ingredientNames,
          ingredient_cursor: 0,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.job_id)

      if (jobStateError) throw jobStateError
    }

    if (cursor >= ingredientNames.length) {
      const finalCache = await findCachedIngredients(admin, sourceIngredients)
      const unresolved = sourceIngredients.filter(
        (name) => !finalCache.has(normalizeCacheKey(name)),
      )

      await syncScanFromCache(admin, typedScan, finalCache, sourceIngredients)

      const status = unresolved.length > 0 ? "partial" : "completed"
      const message = unresolved.length > 0
        ? `${unresolved.length} ingredient(s) could not be analyzed.`
        : null

      await admin
        .from("scans")
        .update({
          analysis_status: status,
          analysis_error: message,
          analysis_updated_at: new Date().toISOString(),
        })
        .eq("id", typedScan.id)

      await markJobComplete(admin, job.job_id)
      return json({ processed: true, scanId: typedScan.id, status })
    }

    const chunk = ingredientNames.slice(cursor, cursor + CHUNK_SIZE)
    const cacheBefore = await findCachedIngredients(admin, sourceIngredients)
    const uncachedChunk = chunk.filter(
      (name) => !cacheBefore.has(normalizeCacheKey(name)),
    )

    if (uncachedChunk.length > 0) {
      await analyzeChunk(
        uncachedChunk.join(", "),
        typedScan.user_id,
        req,
      )
    }

    // Re-read the cache after Gemini. Besides confirming persistence, this
    // makes the worker idempotent if Gemini completed a write but the process
    // died before the scan/job state was advanced.
    const cacheAfter = await findCachedIngredients(admin, sourceIngredients)
    const ids = mergeIngredientIds(typedScan.ingredient_ids ?? [], cacheAfter)
    const score = calculateSafetyScore(
      Array.from(cacheAfter.values()).map((ingredient) => ingredient.safety_level),
    )

    const nextCursor = cursor + chunk.length
    const unresolvedAfterChunk = sourceIngredients.filter(
      (name) => !cacheAfter.has(normalizeCacheKey(name)),
    )

    const { error: scanUpdateError } = await admin
      .from("scans")
      .update({
        ingredient_ids: ids,
        ingredient_count: ids.length,
        safety_score: score,
        analysis_status: nextCursor >= ingredientNames.length
          ? (unresolvedAfterChunk.length > 0 ? "partial" : "completed")
          : "processing",
        analysis_error: nextCursor >= ingredientNames.length && unresolvedAfterChunk.length > 0
          ? `${unresolvedAfterChunk.length} ingredient(s) could not be analyzed.`
          : null,
        analysis_updated_at: new Date().toISOString(),
      })
      .eq("id", typedScan.id)

    if (scanUpdateError) throw scanUpdateError

    if (nextCursor >= ingredientNames.length) {
      await markJobComplete(admin, job.job_id)
      return json({
        processed: true,
        scanId: typedScan.id,
        status: unresolvedAfterChunk.length > 0 ? "partial" : "completed",
      })
    }

    await admin
      .from("scan_analysis_jobs")
      .update({
        status: "pending",
        ingredient_cursor: nextCursor,
        next_attempt_at: new Date().toISOString(),
        locked_at: null,
        lock_until: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.job_id)

    return json({
      processed: true,
      scanId: typedScan.id,
      status: "processing",
      processedIngredients: nextCursor,
      totalIngredients: ingredientNames.length,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown scan analysis error"
    console.error("Scan analysis job failed", {
      jobId: job.job_id,
      scanId: job.scan_id,
      attempts: job.attempts,
      message,
    })

    if (job.attempts >= MAX_ATTEMPTS) {
      await admin
        .from("scans")
        .update({
          analysis_status: "failed",
          analysis_error: "Analysis could not be completed after multiple retries.",
          analysis_updated_at: new Date().toISOString(),
        })
        .eq("id", job.scan_id)

      await markJobFailed(
        admin,
        job.job_id,
        job.attempts,
        message,
      )

      return json({
        processed: true,
        scanId: job.scan_id,
        status: "failed",
      })
    }

    const retryDelaySeconds = Math.min(600, 30 * (2 ** (job.attempts - 1)))
    const nextAttempt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString()

    await admin
      .from("scan_analysis_jobs")
      .update({
        status: "pending",
        next_attempt_at: nextAttempt,
        locked_at: null,
        lock_until: null,
        last_error: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.job_id)

    return json({
      processed: true,
      scanId: job.scan_id,
      status: "retry_scheduled",
    }, 202)
  }
})

async function isValidWorkerRequest(
  req: Request,
  admin: ReturnType<typeof createClient>,
): Promise<boolean> {
  const suppliedToken = req.headers.get("x-scan-worker-token")
  if (!suppliedToken) return false

  const { data, error } = await admin.rpc("get_scan_analysis_worker_token")
  if (error || typeof data !== "string" || !data) return false

  return suppliedToken === data
}

async function analyzeChunk(
  ingredientText: string,
  userId: string,
  req: Request,
) {
  const workerToken = req.headers.get("x-scan-worker-token")
  if (!workerToken) throw new Error("Missing internal worker token")

  const response = await fetch(ANALYZE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // verify_jwt remains enabled on analyze-ingredients. The service-role
      // JWT satisfies the gateway, while the worker token + user id authorize
      // the internal path inside the function.
      "Authorization": `Bearer ${SERVICE_ROLE_KEY}`,
      "x-scan-worker-token": workerToken,
      "x-scan-user-id": userId,
    },
    body: JSON.stringify({ ingredientText }),
  })

  if (!response.ok) {
    const raw = await response.text()
    let message = `Ingredient analysis returned HTTP ${response.status}`
    try {
      const parsed = JSON.parse(raw)
      if (typeof parsed?.error === "string") message = parsed.error
    } catch {
      // Keep the status-based fallback.
    }
    throw new Error(message)
  }

  await response.text()
}

async function findCachedIngredients(
  admin: ReturnType<typeof createClient>,
  names: string[],
): Promise<Map<string, CachedIngredient>> {
  const normalizedNames = names.map(normalizeCacheKey)
  if (normalizedNames.length === 0) return new Map()

  const { data, error } = await admin
    .from("ingredients")
    .select("id, name, safety_level")
    .in("name", normalizedNames)

  if (error) throw error

  return new Map(
    (data ?? []).map((row) => [
      normalizeCacheKey(row.name),
      row as CachedIngredient,
    ]),
  )
}

async function syncScanFromCache(
  admin: ReturnType<typeof createClient>,
  scan: ScanRow,
  cache: Map<string, CachedIngredient>,
  _sourceIngredients: string[],
) {
  const ids = mergeIngredientIds(typedScan.ingredient_ids ?? [], cache)
  const score = calculateSafetyScore(
    Array.from(cache.values()).map((ingredient) => ingredient.safety_level),
  )

  const { error } = await admin
    .from("scans")
    .update({
      ingredient_ids: ids,
      ingredient_count: ids.length,
      safety_score: score,
      analysis_updated_at: new Date().toISOString(),
    })
    .eq("id", scan.id)

  if (error) throw error
}

async function markJobComplete(
  admin: ReturnType<typeof createClient>,
  jobId: string,
) {
  const { error } = await admin
    .from("scan_analysis_jobs")
    .update({
      status: "completed",
      lock_until: null,
      locked_at: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId)

  if (error) throw error
}

async function markJobFailed(
  admin: ReturnType<typeof createClient>,
  jobId: string,
  attempts: number,
  message: string,
) {
  const { error } = await admin
    .from("scan_analysis_jobs")
    .update({
      status: "failed",
      lock_until: null,
      locked_at: null,
      last_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    })
    .eq("id", jobId)

  if (error) {
    console.error("Failed to persist terminal scan job failure", {
      jobId,
      attempts,
      error,
    })
  }
}

function mergeIngredientIds(
  currentIds: string[],
  cache: Map<string, CachedIngredient>,
): string[] {
  const seen = new Set(currentIds)
  const merged = [...currentIds]

  for (const ingredient of cache.values()) {
    if (seen.has(ingredient.id)) continue
    seen.add(ingredient.id)
    merged.push(ingredient.id)
  }

  return merged
}

function calculateSafetyScore(levels: readonly string[]): number {
  if (levels.length === 0) return 50

  const weights: Record<string, number> = {
    safe: 100,
    caution: 50,
    harmful: 0,
    unknown: 60,
  }

  const total = levels.reduce(
    (sum, level) => sum + (weights[level] ?? weights.unknown),
    0,
  )

  return Math.round(total / levels.length)
}

function parseIngredientNames(text: string): string[] {
  const cleaned = text
    .replace(/\n/g, ", ")
    .replace(/[^\w\s,.;()\-\/]/g, "")
    .replace(/\s+/g, " ")
    .trim()

  const parts: string[] = []
  let depth = 0
  let start = 0

  for (let index = 0; index < cleaned.length; index++) {
    const char = cleaned[index]

    if (char === "(") {
      depth++
      continue
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1)
      continue
    }

    if ((char === "," || char === ";" || char === "\n") && depth === 0) {
      const part = cleaned.slice(start, index).trim()
      if (part.length > 1) parts.push(part)
      start = index + 1
    }
  }

  const lastPart = cleaned.slice(start).trim()
  if (lastPart.length > 1) parts.push(lastPart)

  const seen = new Set<string>()
  return parts
    .map((part) => part.toLowerCase().trim())
    .filter((part) => part.length > 1 && part.length < 2000)
    .filter((part) => {
      if (seen.has(part)) return false
      seen.add(part)
      return true
    })
    .slice(0, 200)
}

function normalizeCacheKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim()
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  })
}
