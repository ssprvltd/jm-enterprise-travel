import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

async function signature(apiKey: string, secret: string): Promise<string> {
  const raw = new TextEncoder().encode(apiKey + secret + Math.floor(Date.now() / 1000));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("HOTELBEDS_API_KEY");
  const secret = Deno.env.get("HOTELBEDS_API_SECRET");
  if (!apiKey || !secret) return json({
    error: "Hotelbeds Evaluation credentials are not configured.",
    code: "HOTELBEDS_CREDENTIALS_MISSING",
    required_secrets: ["HOTELBEDS_API_KEY", "HOTELBEDS_API_SECRET"],
    mode: "evaluation",
  }, 503);

  let input: Record<string, unknown>;
  try {
    const value = await req.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    input = value as Record<string, unknown>;
  } catch {
    return json({ error: "A JSON object is required." }, 400);
  }

  const checkIn = String(input.checkIn || "").trim();
  const checkOut = String(input.checkOut || "").trim();
  const hotelCodes = Array.isArray(input.hotelCodes) ? input.hotelCodes : [];
  const adults = Number(input.adults ?? 1);
  const rooms = Number(input.rooms ?? 1);
  const children = Number(input.children ?? 0);

  const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  if (!validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn)
    return json({ error: "checkIn/checkOut must be valid YYYY-MM-DD dates; checkOut must be later." }, 400);
  if (!hotelCodes.length || hotelCodes.length > 100 || hotelCodes.some((v) => !Number.isInteger(Number(v)) || Number(v) <= 0))
    return json({ error: "hotelCodes must contain 1 to 100 positive Hotelbeds hotel codes." }, 400);
  if (!Number.isInteger(adults) || adults < 1 || adults > 9 || !Number.isInteger(rooms) || rooms < 1 || rooms > 8 || !Number.isInteger(children) || children < 0 || children > 8)
    return json({ error: "Invalid room/adult/child count." }, 400);

  const payload = {
    stay: { checkIn, checkOut },
    occupancies: [{ rooms, adults, children }],
    hotels: { hotel: hotelCodes.map(Number) },
  };

  try {
    const response = await fetch("https://api.test.hotelbeds.com/hotel-api/1.0/hotels", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-key": apiKey,
        "X-Signature": await signature(apiKey, secret),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      return json({ error: "Hotelbeds Evaluation search failed.", upstream_status: response.status, details: data }, 502);
    return json({ provider: "Hotelbeds", mode: "evaluation", live_booking: false, ...data });
  } catch {
    return json({ error: "Could not reach Hotelbeds Evaluation API." }, 502);
  }
});