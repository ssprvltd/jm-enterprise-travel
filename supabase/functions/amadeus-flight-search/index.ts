import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigin = "https://ssprvltd.github.io";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Best-effort per-isolate throttle. Provider-side quotas remain the authoritative limit.
const recent = new Map<string, number[]>();

Deno.serve(async (req: Request) => {
  const originHeader = req.headers.get("origin");
  if (originHeader && originHeader !== allowedOrigin) return json({ error: "Origin not allowed." }, 403);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const now = Date.now();
  const calls = (recent.get(ip) || []).filter((time) => now - time < 60_000);
  if (calls.length >= 8) return json({ error: "Too many searches. Please wait one minute." }, 429);
  calls.push(now);
  recent.set(ip, calls);

  const mode = Deno.env.get("AMADEUS_MODE") === "production" ? "production" : "test";
  const apiKey = mode === "production"
    ? Deno.env.get("AMADEUS_PRODUCTION_API_KEY")
    : Deno.env.get("AMADEUS_API_KEY");
  const apiSecret = mode === "production"
    ? Deno.env.get("AMADEUS_PRODUCTION_API_SECRET")
    : Deno.env.get("AMADEUS_API_SECRET");
  const apiBase = mode === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";

  if (!apiKey || !apiSecret) {
    const required = mode === "production"
      ? ["AMADEUS_PRODUCTION_API_KEY", "AMADEUS_PRODUCTION_API_SECRET"]
      : ["AMADEUS_API_KEY", "AMADEUS_API_SECRET"];
    return json({
      error: `Amadeus ${mode === "production" ? "Production" : "Sandbox"} credentials are not configured.`,
      code: "AMADEUS_CREDENTIALS_MISSING",
      required_secrets: required,
      mode,
    }, 503);
  }

  let input: Record<string, unknown>;
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid JSON object");
    input = value as Record<string, unknown>;
  } catch {
    return json({ error: "A JSON object is required." }, 400);
  }

  const origin = String(input.origin || "").trim().toUpperCase();
  const destination = String(input.destination || "").trim().toUpperCase();
  const departureDate = String(input.departureDate || "").trim();
  const returnDate = input.returnDate ? String(input.returnDate).trim() : "";
  const adults = Number(input.adults ?? 1);

  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + "T00:00:00.000Z").toISOString().slice(0, 10) === value;

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination) || origin === destination) {
    return json({ error: "Use valid 3-letter IATA airport/city codes." }, 400);
  }
  if (!validDate(departureDate)) return json({ error: "departureDate must be a valid YYYY-MM-DD date." }, 400);
  if (returnDate && (!validDate(returnDate) || returnDate <= departureDate)) {
    return json({ error: "returnDate must be a valid date after departureDate." }, 400);
  }
  if (!Number.isInteger(adults) || adults < 1 || adults > 9) {
    return json({ error: "adults must be from 1 to 9." }, 400);
  }

  try {
    const tokenRes = await fetch(`${apiBase}/v1/security/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: apiKey,
        client_secret: apiSecret,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const token = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok || !token.access_token) {
      return json({ error: `Amadeus ${mode} authentication failed.`, upstream_status: tokenRes.status }, 502);
    }

    const params = new URLSearchParams({
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate,
      adults: String(adults),
      currencyCode: "USD",
      max: "20",
    });
    if (returnDate) params.set("returnDate", returnDate);

    const response = await fetch(`${apiBase}/v2/shopping/flight-offers?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return json({ error: `Amadeus ${mode} flight search failed.`, upstream_status: response.status }, 502);
    }

    return json({ provider: "Amadeus", mode, live_booking: false, ...data });
  } catch {
    return json({ error: `Could not reach Amadeus ${mode} API.` }, 502);
  }
});
