import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import {
  SCAN_ANALYSIS_CHUNK_SIZE,
  calculateSafetyScore,
  getAnalysisStatus,
  getRetryDelaySeconds,
  mergeIngredientIds,
  normalizeCacheKey,
  parseIngredientNames,
  shouldFailAfterRetry,
} from "./logic.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
const ANALYZE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/analyze-ingredients`

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
  analysis_status: "pending" | "processing" | "completed" | "partial" | "failed"
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
      .select("id, user_id, raw_ocr_text, ingredient_ids, analysis_status")
      .eq("id", job.scan_id)
      .maybeSingle()

    if (scanError) throw scanError

    const scan = rawScan as ScanRow | null

    if (!scan) {
      await markJobComplete(admin, job.job_id)
      return json({ processed: true, scanId: job.scan_id, reason: "scan_missing" })
    }

    if (scan.analysis_status === "completed" || scan.analysis_status === "partial") {
      await markJobComplete(admin, job.job_id)
      return json({
        processed: true,
        scanId: scan.id,
        status: scan.analysis_status,
        reason: "scan_already_final",
      })
    }

    if (scan.analysis_status === "failed") {
      await markJobFailed(admin, job.job_id, job.attempts, "Scan already marked failed.")
      return json({
        processed: true,
        scanId: scan.id,
        status: "failed",
        reason: "scan_already_failed",
      })
    }

    await updateScan(admin, scan.id, {
      analysis_status: "processing",
      analysis_error: null,
      analysis_updated_at: new Date().toISOString(),
    })

    const sourceIngredients = parseIngredientNames(scan.raw_ocr_text ?? "")
    if (sourceIngredients.length === 0) {
      await admin
        .from("scans")
        .update({
          analysis_status: "failed",
          analysis_error: "No ingredients could be identified.",
          analysis_updated_at: new Date().toISOString(),
        })
        .eq("id", scan.id)

      await markJobFailed(admin, job.job_id, job.attempts, "No ingredients could be identified.")
      return json({ processed: true, scanId: scan.id, status: "failed" })
    }

    const { data: retryState, error: retryStateError } = await admin
      .from("scan_analysis_jobs")
      .select("retry_count")
      .eq("id", job.job_id)
      .single()

    if (retryStateError) throw retryStateError

    const retryCount = retryState.retry_count
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
        await syncScanFromCache(admin, scan, initialCache)
        await updateScan(admin, scan.id, {
          analysis_status: "completed",
          analysis_error: null,
          analysis_updated_at: new Date().toISOString(),
        })
        await markJobComplete(admin, job.job_id)
        return json({ processed: true, scanId: scan.id, status: "completed" })
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

      await syncScanFromCache(admin, scan, finalCache)

      const status = unresolved.length > 0 ? "partial" : "completed"
      const message = unresolved.length > 0
        ? `${unresolved.length} ingredient(s) could not be analyzed.`
        : null

      await updateScan(admin, scan.id, {
        analysis_status: status,
        analysis_error: message,
        analysis_updated_at: new Date().toISOString(),
      })

      await markJobComplete(admin, job.job_id)
      return json({ processed: true, scanId: scan.id, status })
    }

    const chunk = ingredientNames.slice(cursor, cursor + SCAN_ANALYSIS_CHUNK_SIZE)
    const cacheBefore = await findCachedIngredients(admin, sourceIngredients)
    const uncachedChunk = chunk.filter(
      (name) => !cacheBefore.has(normalizeCacheKey(name)),
    )

    if (uncachedChunk.length > 0) {
      await analyzeChunk(
        uncachedChunk.join(", "),
        scan.user_id,
        req,
      )
    }

    // Re-read the cache after Gemini. Besides confirming persistence, this
    // makes the worker idempotent if Gemini completed a write but the process
    // died before the scan/job state was advanced.
    const cacheAfter = await findCachedIngredients(admin, sourceIngredients)
    const ids = mergeIngredientIds(scan.ingredient_ids ?? [], cacheAfter)
    const score = calculateSafetyScore(
      Array.from(cacheAfter.values()).map((ingredient) => ingredient.safety_level),
    )

    const nextCursor = cursor + chunk.length
    const unresolvedAfterChunk = sourceIngredients.filter(
      (name) => !cacheAfter.has(normalizeCacheKey(name)),
    )

    const nextStatus = getAnalysisStatus(
      nextCursor,
      ingredientNames.length,
      unresolvedAfterChunk.length,
    )

    await updateScan(admin, scan.id, {
      ingredient_ids: ids,
      ingredient_count: ids.length,
      safety_score: score,
      analysis_status: nextStatus,
      analysis_error:
        nextStatus === "partial"
          ? `${unresolvedAfterChunk.length} ingredient(s) could not be analyzed.`
          : null,
      analysis_updated_at: new Date().toISOString(),
    })

    if (nextCursor >= ingredientNames.length) {
      await markJobComplete(admin, job.job_id)
      return json({
        processed: true,
        scanId: scan.id,
        status: unresolvedAfterChunk.length > 0 ? "partial" : "completed",
      })
    }

    await updateJob(admin, job.job_id, {
      status: "pending",
      ingredient_cursor: nextCursor,
      next_attempt_at: new Date().toISOString(),
      locked_at: null,
      lock_until: null,
      retry_count: 0,
      last_error: null,
      updated_at: new Date().toISOString(),
    })

    return json({
      processed: true,
      scanId: scan.id,
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

    const nextRetryCount = retryCount + 1

    if (shouldFailAfterRetry(nextRetryCount)) {
      await updateScan(admin, job.scan_id, {
        analysis_status: "failed",
        analysis_error: "Analysis could not be completed after multiple retries.",
        analysis_updated_at: new Date().toISOString(),
      })

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

    const retryDelaySeconds = getRetryDelaySeconds(nextRetryCount)
    const nextAttempt = new Date(Date.now() + retryDelaySeconds * 1000).toISOString()

    await updateJob(admin, job.job_id, {
      status: "pending",
      next_attempt_at: nextAttempt,
      locked_at: null,
      lock_until: null,
      retry_count: nextRetryCount,
      last_error: message.slice(0, 2000),
      updated_at: new Date().toISOString(),
    })

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
) {
  const ids = mergeIngredientIds(scan.ingredient_ids ?? [], cache)
  const score = calculateSafetyScore(
    Array.from(cache.values()).map((ingredient) => ingredient.safety_level),
  )

  await updateScan(admin, scan.id, {
    ingredient_ids: ids,
    ingredient_count: ids.length,
    safety_score: score,
    analysis_updated_at: new Date().toISOString(),
  })
}

async function markJobComplete(
  admin: ReturnType<typeof createClient>,
  jobId: string,
) {
  await updateJob(admin, jobId, {
    status: "completed",
    retry_count: 0,
    lock_until: null,
    locked_at: null,
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
}

async function updateScan(
  admin: ReturnType<typeof createClient>,
  scanId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin
    .from("scans")
    .update(values)
    .eq("id", scanId)

  if (error) throw error
}

async function updateJob(
  admin: ReturnType<typeof createClient>,
  jobId: string,
  values: Record<string, unknown>,
) {
  const { error } = await admin
    .from("scan_analysis_jobs")
    .update(values)
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

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  })
}
