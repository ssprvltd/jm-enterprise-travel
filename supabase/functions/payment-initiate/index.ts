import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const storeId = Deno.env.get("SSLCOMMERZ_STORE_ID");
  const storePass = Deno.env.get("SSLCOMMERZ_STORE_PASSWORD");
  const mode = Deno.env.get("SSLCOMMERZ_MODE") || "sandbox";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!storeId || !storePass || !supabaseUrl || !serviceKey) {
    return json({ error: "Payment gateway credentials are not configured.", code: "SSLCOMMERZ_CREDENTIALS_MISSING" }, 503);
  }

  let body: { order_ref?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const orderRef = String(body.order_ref || "").trim();
  if (!orderRef || orderRef.length > 64) return json({ error: "A valid order_ref is required." }, 400);

  const dbHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" };
  const orderUrl = `${supabaseUrl}/rest/v1/travel_orders?select=*&order_ref=eq.${encodeURIComponent(orderRef)}&limit=1`;
  const orderResponse = await fetch(orderUrl, { headers: dbHeaders });
  if (!orderResponse.ok) return json({ error: "Could not retrieve the booking order." }, 502);
  const orders = await orderResponse.json();
  const order = orders?.[0];
  if (!order) return json({ error: "Booking order not found." }, 404);
  if (order.status === "paid") return json({ error: "This booking is already paid." }, 409);

  const tranId = "JM" + crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  const updateResponse = await fetch(`${supabaseUrl}/rest/v1/travel_orders?order_ref=eq.${encodeURIComponent(orderRef)}`, {
    method: "PATCH",
    headers: { ...dbHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ ssl_tran_id: tranId, updated_at: new Date().toISOString() }),
  });
  if (!updateResponse.ok) return json({ error: "Could not prepare the payment transaction." }, 502);

  const sandbox = mode !== "live";
  const endpoint = sandbox
    ? "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
    : "https://securepay.sslcommerz.com/gwprocess/v4/api.php";
  const site = "https://ssprvltd.github.io/jm-enterprise-travel";
  const ipn = `${supabaseUrl}/functions/v1/payment-ipn`;
  const params = new URLSearchParams({
    store_id: storeId,
    store_passwd: storePass,
    total_amount: Number(order.amount_bdt).toFixed(2),
    currency: "BDT",
    tran_id: tranId,
    success_url: `${site}/payment-result.html?status=success`,
    fail_url: `${site}/payment-result.html?status=failed`,
    cancel_url: `${site}/payment-result.html?status=cancelled`,
    ipn_url: ipn,
    product_name: String(order.description || "Travel booking").slice(0, 255),
    product_category: "Travel",
    product_profile: "general",
    shipping_method: "NO",
    num_of_item: "1",
    cus_name: String(order.customer_name).slice(0, 50),
    cus_email: String(order.customer_email || "jmeworldbd@gmail.com").slice(0, 50),
    cus_add1: "Dhaka",
    cus_city: "Dhaka",
    cus_postcode: "1200",
    cus_country: "Bangladesh",
    cus_phone: String(order.customer_phone).slice(0, 20),
  });

  const gatewayResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const result = await gatewayResponse.json().catch(() => ({}));
  if (!gatewayResponse.ok || result.status !== "SUCCESS" || !result.GatewayPageURL) {
    return json({ error: "SSLCOMMERZ could not create a checkout session.", details: result }, 502);
  }
  return json({ gateway_url: result.GatewayPageURL, tran_id: tranId, mode: sandbox ? "sandbox" : "live" });
});
