import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const reply = (message: string, status = 200) => new Response(message, { status });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return reply("Method not allowed", 405);

  const storeId = Deno.env.get("SSLCOMMERZ_STORE_ID");
  const storePass = Deno.env.get("SSLCOMMERZ_STORE_PASSWORD");
  const mode = Deno.env.get("SSLCOMMERZ_MODE") || "sandbox";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!storeId || !storePass || !supabaseUrl || !serviceKey) return reply("Gateway not configured", 503);

  const form = await req.formData().catch(() => null);
  if (!form) return reply("Invalid notification", 400);
  const valId = String(form.get("val_id") || "");
  const tranId = String(form.get("tran_id") || "");
  if (!valId || !tranId) return reply("Missing transaction identifiers", 400);

  const sandbox = mode !== "live";
  const validator = sandbox
    ? "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"
    : "https://securepay.sslcommerz.com/validator/api/validationserverAPI.php";
  const validationUrl = new URL(validator);
  validationUrl.searchParams.set("val_id", valId);
  validationUrl.searchParams.set("store_id", storeId);
  validationUrl.searchParams.set("store_passwd", storePass);
  validationUrl.searchParams.set("format", "json");

  const validationResponse = await fetch(validationUrl);
  const validation = await validationResponse.json().catch(() => ({}));
  if (!validationResponse.ok || !["VALID", "VALIDATED"].includes(validation.status)) {
    return reply("Payment not validated", 400);
  }

  const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const orderUrl = `${supabaseUrl}/rest/v1/travel_orders?select=*&ssl_tran_id=eq.${encodeURIComponent(tranId)}&limit=1`;
  const orderResponse = await fetch(orderUrl, { headers: dbHeaders });
  if (!orderResponse.ok) return reply("Order lookup failed", 502);
  const orders = await orderResponse.json();
  const order = orders?.[0];
  if (!order) return reply("Unknown transaction", 404);

  const amountMatches = Math.abs(Number(validation.amount) - Number(order.amount_bdt)) < 0.01;
  const currencyMatches = validation.currency === "BDT";
  const transactionMatches = validation.tran_id === tranId;
  if (!amountMatches || !currencyMatches || !transactionMatches) return reply("Transaction details do not match", 400);

  if (String(validation.risk_level) === "1") {
    return reply("Payment received; manual risk review required", 202);
  }

  const update = await fetch(`${supabaseUrl}/rest/v1/travel_orders?order_ref=eq.${encodeURIComponent(order.order_ref)}`, {
    method: "PATCH",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ status: "paid", ssl_val_id: valId, updated_at: new Date().toISOString() }),
  });
  if (!update.ok) return reply("Could not update order", 502);
  return reply("Payment validated");
});
