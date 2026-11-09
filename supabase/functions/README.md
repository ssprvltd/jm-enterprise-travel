# J M Enterprise API integration

## Deployed Supabase Edge Functions
- `flight-search`: secure server-side Tripgic flight-search proxy.
- `payment-initiate`: creates an SSLCOMMERZ checkout session using a server-created `travel_orders` record.
- `payment-ipn`: validates the SSLCOMMERZ server notification against the gateway validation API and the saved amount/order reference.

## Required Edge Function secrets
Set these in Supabase Dashboard → Edge Functions → Secrets. Never commit them to GitHub or send them in public messages.

### Tripgic sandbox
- `TRIPGIC_API_KEY`
- `TRIPGIC_SECRET_CODE`
- `TRIPGIC_PARTNER_ID`
- `TRIPGIC_BASE_URL` = `https://sandbox.api.tripgic.com/v1`

### SSLCOMMERZ sandbox
- `SSLCOMMERZ_STORE_ID`
- `SSLCOMMERZ_STORE_PASSWORD`
- `SSLCOMMERZ_MODE` = `sandbox`

For production, use the approved live merchant credentials and set `SSLCOMMERZ_MODE=live`.

## Important flow/security notes
- Flight search requires three-letter airport codes such as DAC and DXB.
- Never put Tripgic or SSLCOMMERZ credentials in browser code.
- `travel_orders` is private to server-side service-role operations. The public browser cannot read or create payment orders.
- A trusted server-side booking step must create a `travel_orders` row only after the supplier has validated the fare/booking. The payment function accepts only that existing `order_ref`; it does not trust an amount supplied by the browser.
- SSLCOMMERZ IPN is validated server-to-server before an order is marked paid. The browser redirect page alone never confirms payment.
- The website's existing booking enquiry form remains an enquiry workflow until the Tripgic credentials and booking lifecycle are activated and connected to the UI.
