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
      error: "Flight search is not activated yet.",
      code: "TRIPGIC_CREDENTIALS_MISSING",
      required_secrets: ["TRIPGIC_API_KEY", "TRIPGIC_SECRET_CODE", "TRIPGIC_PARTNER_ID"],
    }, 503);
  }

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return reply({ error: "Invalid JSON body" }, 400); }

  const from = String(input.from || "").trim().toUpperCase();
  const to = String(input.to || "").trim().toUpperCase();
  const date = String(input.date || "").trim();
  const adults = Math.max(1, Math.min(9, Number(input.adults || 1)));

  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) {
    return reply({ error: "Enter valid 3-letter airport codes, e.g. DAC and DXB." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    return reply({ error: "Enter a valid departure date (YYYY-MM-DD)." }, 400);
  }

  const payload = {
    journey_type: "OneWay",
    segment: [{
      departure_airport_type: "AIRPORT",
      departure_airport: from,
      arrival_airport_type: "AIRPORT",
      arrival_airport: to,
      departure_date: date,
    }],
    travelers_adult: adults,
    travelers_child: 0,
    travelers_infants: 0,
    preferred_carrier: [""],
    non_stop_flight: "any",
    baggage_option: "any",
    booking_class: "Economy",
    supplier_uid: "all",
    partner_id: partnerId,
    language: "en",
  };

  try {
    const upstream = await fetch(baseUrl + "/flight/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
        "secretecode": secretCode,
      },
      body: JSON.stringify(payload),
    });
    const data = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      return reply({ error: "Flight supplier request failed.", upstream_status: upstream.status, details: data }, 502);
    }
    return reply(data);
  } catch (error) {
    return reply({ error: "Could not reach flight supplier.", details: error instanceof Error ? error.message : "Unknown error" }, 502);
  }
});
