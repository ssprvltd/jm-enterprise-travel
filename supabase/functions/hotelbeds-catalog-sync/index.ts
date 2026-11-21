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
function listFrom(data: any, keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  for (const key of keys) if (Array.isArray(data?.[key])) return data[key];
  return [];
}
async function upsertRows(table: string, rows: any[], url: string, serviceKey: string) {
  if (!rows.length) return 0;
  const response = await fetch(`${url}/rest/v1/${table}?on_conflict=code`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!response.ok) throw new Error(`Database upsert failed for ${table}: ${response.status} ${(await response.text()).slice(0, 300)}`);
  return rows.length;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = Deno.env.get("HOTELBEDS_API_KEY");
  const secret = Deno.env.get("HOTELBEDS_API_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !secret || !supabaseUrl || !serviceKey) {
    return json({
      error: "Required server secrets/environment are missing.",
      required: ["HOTELBEDS_API_KEY", "HOTELBEDS_API_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    }, 503);
  }

  let input: any = {};
  try { input = await req.json(); } catch { return json({ error: "JSON body required" }, 400); }
  const from = Number(input.from ?? 1);
  const hotelTo = Number(input.hotelTo ?? 1000);
  const destinationTo = Number(input.destinationTo ?? 100);
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(hotelTo) || hotelTo < from || hotelTo - from > 999 ||
      !Number.isInteger(destinationTo) || destinationTo < 1 || destinationTo > 1000) {
    return json({ error: "Invalid page range. Hotels are limited to 1000 records per run; destinations to 1000." }, 400);
  }

  try {
    const sig = await signature(apiKey, secret);
    const headers = { "Api-key": apiKey, "X-Signature": sig, Accept: "application/json" };
    const base = "https://api.test.hotelbeds.com/hotel-content-api/1.0";
    const [destResponse, hotelResponse] = await Promise.all([
      fetch(`${base}/locations/destinations?fields=all&language=ENG&from=1&to=${destinationTo}&useSecondaryLanguage=true`, { headers, signal: AbortSignal.timeout(25000) }),
      fetch(`${base}/hotels?fields=all&language=ENG&from=${from}&to=${hotelTo}`, { headers, signal: AbortSignal.timeout(25000) }),
    ]);
    const destBody = await destResponse.json().catch(() => ({}));
    const hotelBody = await hotelResponse.json().catch(() => ({}));
    if (!destResponse.ok || !hotelResponse.ok) {
      return json({
        error: "Hotelbeds Content API Evaluation request failed.",
        destination_status: destResponse.status,
        hotel_status: hotelResponse.status,
        destination_error: destBody,
        hotel_error: hotelBody,
        mode: "evaluation",
      }, 502);
    }

    const destinations = listFrom(destBody, ["destinations", "destination"]).map((d: any) => ({
      code: String(d.code ?? d.destinationCode ?? d.destination ?? "").trim(),
      name: String(d.name ?? d.description ?? d.destinationName ?? "").trim(),
      country_code: d.countryCode ?? d.isoCode ?? null,
      raw: d,
      synced_at: new Date().toISOString(),
    })).filter((d: any) => d.code && d.name);

    const hotels = listFrom(hotelBody, ["hotels", "hotel"]).map((h: any) => ({
      code: String(h.code ?? h.hotelCode ?? "").trim(),
      name: String(h.name ?? h.hotelName ?? "").trim(),
      destination_code: h.destinationCode ?? h.destination?.code ?? null,
      country_code: h.countryCode ?? h.country?.code ?? null,
      city: h.city ?? h.cityName ?? null,
      address: h.address ?? h.address?.content ?? null,
      category: h.categoryCode ?? h.category ?? null,
      latitude: Number.isFinite(Number(h.coordinates?.latitude)) ? Number(h.coordinates.latitude) : null,
      longitude: Number.isFinite(Number(h.coordinates?.longitude)) ? Number(h.coordinates.longitude) : null,
      raw: h,
      synced_at: new Date().toISOString(),
    })).filter((h: any) => h.code && h.name);

    const [destinationCount, hotelCount] = await Promise.all([
      upsertRows("hotelbeds_destinations", destinations, supabaseUrl, serviceKey),
      upsertRows("hotelbeds_hotels", hotels, supabaseUrl, serviceKey),
    ]);
    return json({
      provider: "Hotelbeds",
      mode: "evaluation",
      live_booking: false,
      synced: { destinations: destinationCount, hotels: hotelCount },
      requested_ranges: { destinations: `1-${destinationTo}`, hotels: `${from}-${hotelTo}` },
      note: "This is a partial catalog page. Run additional non-overlapping hotel ranges only when needed; do not call Content API for each customer search.",
    });
  } catch (error) {
    return json({ error: "Hotelbeds catalog sync failed.", details: String(error).slice(0, 500) }, 502);
  }
});