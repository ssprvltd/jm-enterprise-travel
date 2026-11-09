import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("TRIPGIC_API_KEY");
  const secretCode = Deno.env.get("TRIPGIC_SECRET_CODE");
  const partnerId = Deno.env.get("TRIPGIC_PARTNER_ID");
  const baseUrl = (Deno.env.get("TRIPGIC_BASE_URL") || "https://sandbox.api.tripgic.com/v1").replace(/\/$/, "");

  if (!apiKey || !secretCode || !partnerId) {
    return reply({
      error: "Hotel search is not activated yet.",
      code: "TRIPGIC_CREDENTIALS_MISSING",
      required_secrets: ["TRIPGIC_API_KEY", "TRIPGIC_SECRET_CODE", "TRIPGIC_PARTNER_ID"],
    }, 503);
  }

  const raw = await req.text();
  if (raw.length > 50000) return reply({ error: "Request body too large." }, 413);

  let input: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return reply({ error: "JSON object required." }, 400);
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return reply({ error: "Invalid JSON body." }, 400);
  }

  const payload = {
    ...input,
    partner_id: String(input.partner_id || partnerId),
    language: String(input.language || "en"),
  };

  try {
    const upstream = await fetch(baseUrl + "/hotel/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "secretecode": secretCode,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60000),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return reply({ error: "Hotel supplier request failed.", upstream_status: upstream.status, details: data }, 502);
    }
    return reply(data);
  } catch (error) {
    return reply({ error: "Could not reach hotel supplier.", details: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
});