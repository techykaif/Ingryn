import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY")
const GEMINI_API_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? ""
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""

const COUNTRY_STATUS_VALUES = [
  "permitted",
  "permitted_with_limits",
  "banned",
  "under_review",
  "no_data",
  "other",
] as const

const MAX_AUTOMATED_CHANGES = 75

const ALLOWED_DOMAINS: Record<string, string[]> = {
  US: ["fda.gov", "ecfr.gov"],
  EU: ["food.ec.europa.eu", "eur-lex.europa.eu"],
  UK: ["data.food.gov.uk", "food.gov.uk", "legislation.gov.uk"],
  IN: ["fssai.gov.in", "egazette.gov.in", "gazette.nic.in"],
  AU: ["foodstandards.gov.au", "legislation.gov.au"],
  CA: ["canada.ca", "inspection.canada.ca"],
  JP: ["caa.go.jp", "mhlw.go.jp"],
  CN: ["nhc.gov.cn", "std.samr.gov.cn", "sppt.cfsa.net.cn"],
}

type Source = {
  country_code: string
  country_name: string
  source_name: string
  source_url: string
  refresh_interval_days: number
  last_content_hash: string | null
  last_checked_at: string | null
  last_error: string | null
  next_attempt_at: string | null
}

type ExistingRule = {
  ingredient_id: string
  name: string
  aliases: string[] | null
  status: string
  raw_status: string | null
}

type GeminiChange = {
  ingredient_id: string
  name: string
  status: string
  raw_status?: string | null
  evidence: string
  evidence_url: string
  effective_from?: string | null
  effective_until?: string | null
}

type RefreshResult = {
  status: string
  sourceHash?: string
  sourceVersionId?: string
  ingredientsChecked?: number
  ingredientsChanged?: number
  citationsChecked?: number
  citationsValid?: number
  errorMessage?: string
  metadata?: Record<string, unknown>
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-country-refresh-token",
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  if (!GEMINI_API_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: "Server configuration is incomplete." }, 500)
  }

  try {
    const suppliedToken = req.headers.get("x-country-refresh-token")
    if (!suppliedToken) {
      return json({ error: "Unauthorized" }, 401)
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

    const { data: token, error: tokenError } = await admin.rpc(
      "get_country_rule_refresh_token",
    )

    if (tokenError || !token || token !== suppliedToken) {
      return json({ error: "Unauthorized" }, 401)
    }

    const body = await req.json().catch(() => ({}))
    const requestedCountry =
      typeof body?.country_code === "string"
        ? body.country_code.toUpperCase()
        : null

    let { data: sources, error: sourceError } = await admin
      .from("country_rule_sources")
      .select(
        "country_code, country_name, source_name, source_url, refresh_interval_days, last_content_hash, last_checked_at, last_error, next_attempt_at",
      )
      .eq("enabled", true)
      .order("priority", { ascending: true })

    if (sourceError) {
      throw sourceError
    }

    const { data: unverifiedRows, error: unverifiedError } = await admin
      .from("ingredient_country_rules")
      .select("country_code, ingredient_id")
      .is("verified_at", null)

    if (unverifiedError) {
      throw unverifiedError
    }

    const unverifiedByCountry = new Map<string, string[]>()

    for (const row of unverifiedRows ?? []) {
      const current = unverifiedByCountry.get(row.country_code) ?? []
      current.push(row.ingredient_id)
      unverifiedByCountry.set(row.country_code, current)
    }

    const now = Date.now()
    const staleSources = (sources ?? []).filter((item) => {
      if (requestedCountry && item.country_code !== requestedCountry) {
        return false
      }

      if (
        item.next_attempt_at &&
        new Date(item.next_attempt_at).getTime() > now
      ) {
        return false
      }

      const hasUnverifiedRules =
        (unverifiedByCountry.get(item.country_code)?.length ?? 0) > 0

      if (!item.last_checked_at || hasUnverifiedRules) {
        return true
      }

      return (
        now - new Date(item.last_checked_at).getTime() >=
        item.refresh_interval_days * 24 * 60 * 60 * 1000
      )
    })

    const source = staleSources[0] as Source | undefined

    if (!source) {
      return json({ status: "up_to_date" })
    }

    const runId = await startRun(
      admin,
      source.country_code,
      requestedCountry ? "manual" : "scheduled",
    )

    try {
      const fetched = await fetchSource(source.source_url)
      const sourceHash = await sha256(fetched.bytes)

      if (source.last_content_hash === sourceHash) {
        const unverifiedIds =
          unverifiedByCountry.get(source.country_code) ?? []

        if (unverifiedIds.length === 0) {
          await admin
            .from("country_rule_sources")
            .update({
              last_checked_at: new Date().toISOString(),
              last_success_at: new Date().toISOString(),
              last_error: null,
              next_attempt_at: null,
            })
            .eq("country_code", source.country_code)
            .throwOnError()

          await admin
            .from("ingredient_country_rules")
            .update({
              verified_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("country_code", source.country_code)
            .throwOnError()

          await finishRun(admin, runId, {
            status: "unchanged",
            sourceHash,
            metadata: {
              sourceChanged: false,
              sourceName: source.source_name,
              verifiedExistingRules: true,
            },
          })

          return json({
            status: "unchanged",
            country_code: source.country_code,
          })
        }

        const { data: unverifiedIngredients, error: unverifiedIngredientError } =
          await admin
            .from("ingredients")
            .select("id, name, aliases")
            .in("id", unverifiedIds)

        if (unverifiedIngredientError) {
          throw unverifiedIngredientError
        }

        const { data: unverifiedCurrentRules, error: unverifiedRuleError } =
          await admin
            .from("ingredient_country_rules")
            .select("ingredient_id, status, raw_status")
            .eq("country_code", source.country_code)
            .in("ingredient_id", unverifiedIds)

        if (unverifiedRuleError) {
          throw unverifiedRuleError
        }

        const currentRuleMap = new Map(
          (unverifiedCurrentRules ?? []).map((rule) => [
            rule.ingredient_id,
            {
              status: rule.status,
              raw_status: rule.raw_status,
            },
          ]),
        )

        const unverifiedExisting: ExistingRule[] =
          (unverifiedIngredients ?? []).map((ingredient) => ({
            ingredient_id: ingredient.id,
            name: ingredient.name,
            aliases: ingredient.aliases,
            status:
              currentRuleMap.get(ingredient.id)?.status ?? "no_data",
            raw_status:
              currentRuleMap.get(ingredient.id)?.raw_status ?? null,
          }))

        const parsed = await analyzeWithGemini(
          source,
          unverifiedExisting,
        )

        validateChanges(
          parsed.changes,
          source,
          new Map(
            unverifiedExisting.map((item) => [
              item.ingredient_id,
              item,
            ]),
          ),
        )

        if (parsed.changes.length > MAX_AUTOMATED_CHANGES) {
          throw new Error(
            "Automated refresh produced too many changes (" +
              parsed.changes.length +
              "). Leaving published rules unchanged.",
          )
        }

        if (parsed.changes.length > 0) {
          const verification =
            await verifyProposedChangesWithGemini(
              source,
              unverifiedExisting,
              parsed.changes,
            )

          validateVerification(
            verification,
            parsed.changes,
            source,
          )
        }

        const publishedVersionId =
          await latestPublishedVersionId(
            admin,
            source.country_code,
          )

        if (!publishedVersionId) {
          throw new Error(
            "Country source is unchanged but has no published rule version.",
          )
        }

        for (const change of parsed.changes) {
          await admin
            .from("ingredient_country_rules")
            .upsert(
              {
                ingredient_id: change.ingredient_id,
                country_code: source.country_code,
                status: change.status,
                raw_status:
                  change.status === "other"
                    ? change.raw_status ?? null
                    : null,
                source_version_id: publishedVersionId,
                evidence: change.evidence,
                effective_from: validDate(change.effective_from)
                  ? change.effective_from
                  : null,
                effective_until: validDate(change.effective_until)
                  ? change.effective_until
                  : null,
                verified_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
              { onConflict: "ingredient_id,country_code" },
            )
            .throwOnError()
        }

        await admin
          .from("ingredient_country_rules")
          .update({
            source_version_id: publishedVersionId,
            verified_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("country_code", source.country_code)
          .in("ingredient_id", unverifiedIds)
          .throwOnError()

        await admin
          .from("country_rule_sources")
          .update({
            last_checked_at: new Date().toISOString(),
            last_success_at: new Date().toISOString(),
            last_error: null,
            next_attempt_at: null,
          })
          .eq("country_code", source.country_code)
          .throwOnError()

        await finishRun(admin, runId, {
          status: "published",
          sourceHash,
          sourceVersionId: publishedVersionId,
          ingredientsChecked: unverifiedExisting.length,
          ingredientsChanged: parsed.changes.length,
          citationsChecked: parsed.changes.length,
          citationsValid: parsed.changes.length,
          metadata: {
            sourceName: source.source_name,
            sourceUrl: source.source_url,
            grounded: true,
            sourceChanged: false,
            newlyVerifiedIngredients: unverifiedIds.length,
          },
        })

        return json({
          status: "published",
          country_code: source.country_code,
          changed_ingredients: parsed.changes.length,
          verified_ingredients: unverifiedIds.length,
          version: "existing",
        })
      }

      const { data: ingredients, error: ingredientError } = await admin
        .from("ingredients")
        .select("id, name, aliases")
        .order("name")

      if (ingredientError) {
        throw ingredientError
      }

      const { data: currentRules, error: ruleError } = await admin
        .from("ingredient_country_rules")
        .select("ingredient_id, status, raw_status")
        .eq("country_code", source.country_code)

      if (ruleError) {
        throw ruleError
      }

      const ingredientRows = (ingredients ?? []) as Array<{
        id: string
        name: string
        aliases: string[] | null
      }>

      const currentRuleMap = new Map(
        (currentRules ?? []).map((rule) => [
          rule.ingredient_id,
          {
            status: rule.status,
            raw_status: rule.raw_status,
          },
        ]),
      )

      const existing: ExistingRule[] = ingredientRows.map((ingredient) => ({
        ingredient_id: ingredient.id,
        name: ingredient.name,
        aliases: ingredient.aliases,
        status: currentRuleMap.get(ingredient.id)?.status ?? "no_data",
        raw_status: currentRuleMap.get(ingredient.id)?.raw_status ?? null,
      }))

      const parsed = await analyzeWithGemini(source, existing)

      validateChanges(
        parsed.changes,
        source,
        new Map(existing.map((item) => [item.ingredient_id, item])),
      )

      if (parsed.changes.length > MAX_AUTOMATED_CHANGES) {
        throw new Error(
          "Automated refresh produced too many changes (" +
            parsed.changes.length +
            "). Leaving published rules unchanged.",
        )
      }

      if (parsed.changes.length > 0) {
        const verification = await verifyProposedChangesWithGemini(
          source,
          existing,
          parsed.changes,
        )

        validateVerification(
          verification,
          parsed.changes,
          source,
        )
      }

      const versionNumber = await nextVersionNumber(
        admin,
        source.country_code,
      )

      await admin
        .from("country_rule_versions")
        .update({ state: "superseded" })
        .eq("country_code", source.country_code)
        .eq("state", "published")
        .throwOnError()

      const { data: version, error: versionError } = await admin
        .from("country_rule_versions")
        .insert({
          country_code: source.country_code,
          version_number: versionNumber,
          source_url: source.source_url,
          content_hash: sourceHash,
          fetched_at: new Date().toISOString(),
          analyzed_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          state: "published",
          change_summary: {
            source_changed: true,
            changed_count: parsed.changes.length,
            methodology: "gemini_search_grounded",
          },
        })
        .select("id")
        .single()

      if (versionError) {
        throw versionError
      }

      for (const change of parsed.changes) {
        await admin
          .from("ingredient_country_rules")
          .upsert(
            {
              ingredient_id: change.ingredient_id,
              country_code: source.country_code,
              status: change.status,
              raw_status:
                change.status === "other"
                  ? change.raw_status ?? null
                  : null,
              source_version_id: version.id,
              evidence: change.evidence,
              effective_from: validDate(change.effective_from)
                ? change.effective_from
                : null,
              effective_until: validDate(change.effective_until)
                ? change.effective_until
                : null,
              verified_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "ingredient_id,country_code" },
          )
          .throwOnError()
      }

      // Every rule was considered against the newly checked source.
      // Mark all country rows as verified against this published version;
      // changed rows already carry their specific evidence above.
      await admin
        .from("ingredient_country_rules")
        .update({
          source_version_id: version.id,
          verified_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("country_code", source.country_code)
        .throwOnError()

      await admin
        .from("country_rule_sources")
        .update({
          last_checked_at: new Date().toISOString(),
          last_success_at: new Date().toISOString(),
          last_content_hash: sourceHash,
          last_error: null,
          next_attempt_at: null,
        })
        .eq("country_code", source.country_code)
        .throwOnError()

      await finishRun(admin, runId, {
        status: "published",
        sourceHash,
        sourceVersionId: version.id,
        ingredientsChecked: existing.length,
        ingredientsChanged: parsed.changes.length,
        citationsChecked: parsed.changes.length,
        citationsValid: parsed.changes.length,
        metadata: {
          sourceName: source.source_name,
          sourceUrl: source.source_url,
          grounded: true,
        },
      })

      return json({
        status: "published",
        country_code: source.country_code,
        changed_ingredients: parsed.changes.length,
        version: versionNumber,
      })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error"

      await admin
        .from("country_rule_sources")
        .update({
          last_checked_at: new Date().toISOString(),
          last_error: message,
          next_attempt_at: new Date(
            Date.now() + 24 * 60 * 60 * 1000,
          ).toISOString(),
        })
        .eq("country_code", source.country_code)

      await finishRun(admin, runId, {
        status: "failed",
        errorMessage: message,
      })

      throw error
    }
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      500,
    )
  }
})

async function analyzeWithGemini(
  source: Source,
  existing: ExistingRule[],
): Promise<{ changes: GeminiChange[] }> {
  const allowedDomains = ALLOWED_DOMAINS[source.country_code] ?? []

  const ingredientContext = existing
    .map((item) => {
      const aliases = item.aliases?.length
        ? " | aliases: " + item.aliases.slice(0, 8).join(", ")
        : ""

      return (
        "id=" +
        item.ingredient_id +
        "; name=" +
        item.name +
        "; current_status=" +
        item.status +
        "; current_raw_status=" +
        (item.raw_status ?? "") +
        aliases
      )
    })
    .join("\n")

  const prompt =
    "You are updating a regulatory food-additive dataset for INGRYN.\n\n" +
    "Country/region: " +
    source.country_name +
    " (" +
    source.country_code +
    ")\n" +
    "Primary official source: " +
    source.source_url +
    "\n" +
    "Allowed official evidence domains ONLY: " +
    allowedDomains.join(", ") +
    "\n\n" +
    "You MUST use Google Search grounding to check the latest official " +
    "regulatory information. Prefer the primary source above. Secondary " +
    "official government pages are allowed only when they are in the " +
    "allowed domain list.\n\n" +
    "Return ONLY regulatory changes that are supported by current official " +
    "evidence. Do not create, rename, merge, split, or invent ingredients.\n\n" +
    "Rules:\n" +
    "- permitted = explicitly authorized without a specific use limit in " +
    "the cited rule.\n" +
    "- permitted_with_limits = explicitly subject to conditions, maximum " +
    "levels, food-category limits, or comparable restrictions.\n" +
    "- banned = explicitly prohibited, revoked, or otherwise not authorized " +
    "for the relevant food use.\n" +
    "- under_review = official source explicitly indicates active review or " +
    "unresolved authorization status.\n" +
    "- no_data = the source does not provide enough evidence.\n" +
    "- other = a distinct official status that cannot be safely mapped; " +
    "preserve exact source wording in raw_status.\n" +
    "- Do NOT infer a ban from absence from a positive list unless the source " +
    "explicitly states that absence means unauthorized.\n" +
    "- Do not use general health information for regulatory status.\n" +
    "- Every change must include concise evidence and an evidence_url from " +
    "an allowed official domain.\n" +
    "- Return at most one record per ingredient id.\n" +
    "- If there are no supported changes, return an empty changes array.\n\n" +
    "Existing database records:\n" +
    ingredientContext

  const response = await fetch(
    GEMINI_API_URL + "?key=" + GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 32768,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              changes: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    ingredient_id: { type: "STRING" },
                    name: { type: "STRING" },
                    status: {
                      type: "STRING",
                      enum: [...COUNTRY_STATUS_VALUES],
                    },
                    raw_status: { type: "STRING", nullable: true },
                    evidence: { type: "STRING" },
                    evidence_url: { type: "STRING" },
                    effective_from: {
                      type: "STRING",
                      nullable: true,
                    },
                    effective_until: {
                      type: "STRING",
                      nullable: true,
                    },
                  },
                  required: [
                    "ingredient_id",
                    "name",
                    "status",
                    "evidence",
                    "evidence_url",
                  ],
                },
              },
            },
            required: ["changes"],
          },
        },
      }),
    },
  )

  const rawText = await response.text()

  if (!response.ok) {
    throw new Error(
      "Gemini API error " +
        response.status +
        ": " +
        rawText.slice(0, 500),
    )
  }

  let data: any
  try {
    data = JSON.parse(rawText)
  } catch {
    throw new Error("Gemini returned a non-JSON response.")
  }

  const textContent =
    data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!textContent) {
    throw new Error("Gemini returned no structured response.")
  }

  let parsed: { changes: GeminiChange[] }
  try {
    parsed = JSON.parse(textContent)
  } catch {
    throw new Error(
      "Failed to parse grounded country-rule response.",
    )
  }

  if (!Array.isArray(parsed?.changes)) {
    throw new Error("Gemini returned an invalid country-rule shape.")
  }

  const groundingUris = new Set<string>()

  for (
    const chunk of
    data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  ) {
    const uri = chunk?.web?.uri
    if (typeof uri === "string") {
      groundingUris.add(uri)
    }
  }

  ;(parsed.changes as Array<GeminiChange & {
    __groundingUris?: string[]
  }>).forEach((change) => {
    change.__groundingUris = Array.from(groundingUris)
  })

  return parsed
}

function validateChanges(
  changes: GeminiChange[],
  source: Source,
  ingredients: Map<string, ExistingRule>,
) {
  const allowedDomains = ALLOWED_DOMAINS[source.country_code] ?? []
  const seen = new Set<string>()

  for (const change of changes) {
    const existing = ingredients.get(change.ingredient_id)

    if (!existing) {
      throw new Error(
        "Unknown ingredient id in grounded response: " +
          change.ingredient_id,
      )
    }

    if (seen.has(change.ingredient_id)) {
      throw new Error(
        "Duplicate ingredient change: " + change.ingredient_id,
      )
    }

    seen.add(change.ingredient_id)

    if (
      !(COUNTRY_STATUS_VALUES as readonly string[]).includes(
        change.status,
      )
    ) {
      throw new Error("Unsupported country status: " + change.status)
    }

    if (
      change.name.trim().toLowerCase() !==
      existing.name.trim().toLowerCase()
    ) {
      throw new Error(
        "Ingredient name mismatch for " + change.ingredient_id,
      )
    }

    if (change.status === "other" && !change.raw_status?.trim()) {
      throw new Error("Status 'other' requires raw_status.")
    }

    if (!change.evidence?.trim() || !change.evidence_url?.trim()) {
      throw new Error(
        "Every country-rule change requires evidence and evidence_url.",
      )
    }

    const hostname = safeHostname(change.evidence_url)

    if (
      !hostname ||
      !allowedDomains.some(
        (domain) =>
          hostname === domain ||
          hostname.endsWith("." + domain),
      )
    ) {
      throw new Error(
        "Non-official evidence URL for " +
          source.country_code +
          ": " +
          change.evidence_url,
      )
    }

    const groundedUris =
      (change as GeminiChange & {
        __groundingUris?: string[]
      }).__groundingUris ?? []

    if (groundedUris.length === 0) {
      throw new Error(
        "No Google Search grounding metadata was returned.",
      )
    }

    if (!groundedUris.includes(change.evidence_url)) {
      throw new Error(
        "Evidence URL was not present in Gemini grounding metadata: " +
          change.evidence_url,
      )
    }

    if (
      (change.effective_from &&
        !validDate(change.effective_from)) ||
      (change.effective_until &&
        !validDate(change.effective_until))
    ) {
      throw new Error(
        "Invalid effective date for " + change.ingredient_id,
      )
    }
  }
}

async function verifyProposedChangesWithGemini(
  source: Source,
  existing: ExistingRule[],
  changes: GeminiChange[],
): Promise<{
  confirmations: Array<{
    ingredient_id: string
    status: string
    approved: boolean
    evidence: string
    evidence_url: string
  }>
}> {
  const allowedDomains = ALLOWED_DOMAINS[source.country_code] ?? []

  const changeContext = changes
    .map((change) => {
      return (
        "id=" +
        change.ingredient_id +
        "; name=" +
        change.name +
        "; proposed_status=" +
        change.status +
        "; proposed_raw_status=" +
        (change.raw_status ?? "") +
        "; proposed_evidence_url=" +
        change.evidence_url
      )
    })
    .join("\n")

  const currentContext = existing
    .filter((item) => changes.some((change) => change.ingredient_id === item.ingredient_id))
    .map((item) => {
      return (
        "id=" +
        item.ingredient_id +
        "; name=" +
        item.name +
        "; current_status=" +
        item.status +
        "; current_raw_status=" +
        (item.raw_status ?? "")
      )
    })
    .join("\n")

  const prompt =
    "You are the second independent verification pass for an automated " +
    "regulatory data update for INGRYN.\n\n" +
    "Country/region: " +
    source.country_name +
    " (" +
    source.country_code +
    ")\n" +
    "Primary official source: " +
    source.source_url +
    "\n" +
    "Allowed official evidence domains ONLY: " +
    allowedDomains.join(", ") +
    "\n\n" +
    "You MUST use Google Search grounding and verify EVERY proposed change " +
    "against current official regulatory evidence. Do not rely on the " +
    "proposal's evidence.\n\n" +
    "Approve a change only when the official source supports the exact " +
    "ingredient and proposed status for food use. If evidence is ambiguous, " +
    "approve=false. Do not infer bans from absence unless the official source " +
    "explicitly establishes that rule.\n\n" +
    "Current rules:\n" +
    currentContext +
    "\n\nProposed changes:\n" +
    changeContext

  const response = await fetch(
    GEMINI_API_URL + "?key=" + GEMINI_API_KEY,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              confirmations: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    ingredient_id: { type: "STRING" },
                    status: {
                      type: "STRING",
                      enum: [...COUNTRY_STATUS_VALUES],
                    },
                    approved: { type: "BOOLEAN" },
                    evidence: { type: "STRING" },
                    evidence_url: { type: "STRING" },
                  },
                  required: [
                    "ingredient_id",
                    "status",
                    "approved",
                    "evidence",
                    "evidence_url",
                  ],
                },
              },
            },
            required: ["confirmations"],
          },
        },
      }),
    },
  )

  const rawText = await response.text()

  if (!response.ok) {
    throw new Error(
      "Gemini verification error " +
        response.status +
        ": " +
        rawText.slice(0, 500),
    )
  }

  let data: any
  try {
    data = JSON.parse(rawText)
  } catch {
    throw new Error("Gemini verification returned non-JSON.")
  }

  const textContent =
    data.candidates?.[0]?.content?.parts?.[0]?.text

  if (!textContent) {
    throw new Error("Gemini verification returned no response.")
  }

  let parsed: {
    confirmations: Array<{
      ingredient_id: string
      status: string
      approved: boolean
      evidence: string
      evidence_url: string
    }>
  }

  try {
    parsed = JSON.parse(textContent)
  } catch {
    throw new Error("Failed to parse Gemini verification response.")
  }

  const groundingUris = new Set<string>()

  for (
    const chunk of
    data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []
  ) {
    const uri = chunk?.web?.uri
    if (typeof uri === "string") {
      groundingUris.add(uri)
    }
  }

  ;(parsed.confirmations ?? []).forEach((item) => {
    ;(item as any).__groundingUris = Array.from(groundingUris)
  })

  return parsed
}

function validateVerification(
  verification: {
    confirmations: Array<{
      ingredient_id: string
      status: string
      approved: boolean
      evidence: string
      evidence_url: string
      __groundingUris?: string[]
    }>
  },
  changes: GeminiChange[],
  source: Source,
) {
  const allowedDomains = ALLOWED_DOMAINS[source.country_code] ?? []
  const byId = new Map(
    verification.confirmations.map((item) => [item.ingredient_id, item]),
  )

  for (const change of changes) {
    const confirmation = byId.get(change.ingredient_id)

    if (!confirmation) {
      throw new Error(
        "Missing independent verification for " +
          change.ingredient_id,
      )
    }

    if (!confirmation.approved) {
      throw new Error(
        "Independent verification rejected " +
          change.ingredient_id +
          ".",
      )
    }

    if (confirmation.status !== change.status) {
      throw new Error(
        "Independent verification status mismatch for " +
          change.ingredient_id +
          ".",
      )
    }

    if (
      !confirmation.evidence?.trim() ||
      !confirmation.evidence_url?.trim()
    ) {
      throw new Error(
        "Independent verification is missing evidence for " +
          change.ingredient_id +
          ".",
      )
    }

    const hostname = safeHostname(confirmation.evidence_url)

    if (
      !hostname ||
      !allowedDomains.some(
        (domain) =>
          hostname === domain ||
          hostname.endsWith("." + domain),
      )
    ) {
      throw new Error(
        "Non-official verification URL for " +
          source.country_code +
          ": " +
          confirmation.evidence_url,
      )
    }

    if (
      !confirmation.__groundingUris ||
      !confirmation.__groundingUris.includes(
        confirmation.evidence_url,
      )
    ) {
      throw new Error(
        "Verification URL was not present in Gemini grounding metadata: " +
          confirmation.evidence_url,
      )
    }
  }

  if (verification.confirmations.length !== changes.length) {
    throw new Error(
      "Independent verification returned an unexpected number of confirmations.",
    )
  }
}

function validDate(value?: string | null): boolean {
  return (
    !!value &&
    /^\d{4}-\d{2}-\d{2}$/.test(value)
  )
}

function safeHostname(value: string): string | null {
  try {
    return new URL(value).hostname
      .toLowerCase()
      .replace(/^www\./, "")
  } catch {
    return null
  }
}

async function fetchSource(
  url: string,
): Promise<{ bytes: Uint8Array }> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "INGRYN-CountryRuleRefresh/1.0 (+https://ingryn.app)",
    },
  })

  if (!response.ok) {
    throw new Error(
      "Source fetch failed with HTTP " + response.status + ".",
    )
  }

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes,
  )

  return Array.from(new Uint8Array(digest))
    .map((value) =>
      value.toString(16).padStart(2, "0"),
    )
    .join("")
}

async function latestPublishedVersionId(
  admin: ReturnType<typeof createClient>,
  countryCode: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("country_rule_versions")
    .select("id")
    .eq("country_code", countryCode)
    .eq("state", "published")
    .order("version_number", { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  return data?.[0]?.id ?? null
}

async function nextVersionNumber(
  admin: ReturnType<typeof createClient>,
  countryCode: string,
) {
  const { data, error } = await admin
    .from("country_rule_versions")
    .select("version_number")
    .eq("country_code", countryCode)
    .order("version_number", { ascending: false })
    .limit(1)

  if (error) {
    throw error
  }

  return (data?.[0]?.version_number ?? 0) + 1
}

async function startRun(
  admin: ReturnType<typeof createClient>,
  countryCode: string,
  triggerType: string,
) {
  const { data, error } = await admin
    .from("country_rule_refresh_runs")
    .insert({
      country_code: countryCode,
      trigger_type: triggerType,
      status: "started",
    })
    .select("id")
    .single()

  if (error) {
    throw error
  }

  return data.id as string
}

async function finishRun(
  admin: ReturnType<typeof createClient>,
  runId: string,
  result: RefreshResult,
) {
  await admin
    .from("country_rule_refresh_runs")
    .update({
      status: result.status,
      source_hash: result.sourceHash ?? null,
      source_version_id: result.sourceVersionId ?? null,
      ingredients_checked: result.ingredientsChecked ?? 0,
      ingredients_changed: result.ingredientsChanged ?? 0,
      citations_checked: result.citationsChecked ?? 0,
      citations_valid: result.citationsValid ?? 0,
      finished_at: new Date().toISOString(),
      error_message: result.errorMessage ?? null,
      metadata: result.metadata ?? null,
    })
    .eq("id", runId)
    .throwOnError()
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  })
}
