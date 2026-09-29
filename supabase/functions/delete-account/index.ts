import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405)
  }

  const authHeader = req.headers.get("authorization")
  if (!authHeader?.match(/^Bearer\s+\S+$/i)) {
    return json({ error: "Missing authorization" }, 401)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error("delete-account: missing server configuration")
    return json({ error: "Server configuration error" }, 500)
  }

  try {
    const token = authHeader.replace(/^Bearer\s+/i, "")
    const authClient = createClient(supabaseUrl, supabaseAnonKey)
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token)

    if (authError || !user) {
      return json({ error: "Unauthorized" }, 401)
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey)
    const { error: deleteError } = await adminClient.rpc("delete_user_account", {
      target_user_id: user.id,
    })

    if (deleteError) {
      console.error("delete-account: database deletion failed", deleteError.message)
      return json({ error: "Could not delete account. Please try again." }, 500)
    }

    return json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error"
    console.error("delete-account: unexpected failure", message)
    return json({ error: "Could not delete account. Please try again." }, 500)
  }
})
