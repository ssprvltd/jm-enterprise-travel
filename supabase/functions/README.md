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


## Current integration status (reviewed 2026-11-21)

### Amadeus flight search
- Deployed function: `amadeus-flight-search` (public endpoint; rate-limited in function memory).
- Uses the **Amadeus test API only**: `https://test.api.amadeus.com`.
- Test secrets: `AMADEUS_API_KEY`, `AMADEUS_API_SECRET`.
- Optional production switch: set `AMADEUS_MODE=production` and configure separate `AMADEUS_PRODUCTION_API_KEY`, `AMADEUS_PRODUCTION_API_SECRET` after Amadeus approves the app for production. If `AMADEUS_MODE` is unset or not `production`, the function remains in test mode.
- Production API base is `https://api.amadeus.com`; test base is `https://test.api.amadeus.com`.
- Returns test flight offers only. The function explicitly returns `mode: "test"` and `live_booking: false`; it does not issue tickets or confirm bookings.
- Production API access and a separate booking/ticketing workflow are required before selling tickets.

### Hotelbeds hotel search and catalog
- Deployed functions: `hotelbeds-search` and `hotelbeds-catalog-sync`.
- Both currently call Hotelbeds **Evaluation/Test** endpoints; results are not live inventory and do not confirm a reservation.
- Required secrets: `HOTELBEDS_API_KEY`, `HOTELBEDS_API_SECRET`. Catalog sync also relies on Supabase's server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment.
- Hotelbeds functions require a valid Supabase JWT. Do not disable JWT verification without adding an explicit server-side authorization and abuse-prevention design.
- The public website currently collects a hotel availability enquiry and sends it to the team; it does not expose a public live Hotelbeds search or booking flow.

### Website behavior
- Flight search on the public page uses Amadeus test offers only.
- Hotel tab collects dates, destination, rooms, guests and contact details as an enquiry. The enquiry is saved to `contact_enquiries` and opened in WhatsApp; it is not a confirmed hotel booking.
- Holiday package and visa requests remain contact/enquiry workflows.
- The official J M Enterprise logo is embedded in the site.

### Booking and payment readiness
- `payment-initiate` and `payment-ipn` are deployed, but payment requires configured SSLCOMMERZ credentials and a trusted server-side order-creation/booking step.
- Required sandbox secrets: `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD`, `SSLCOMMERZ_MODE=sandbox`.
- Live payments require an approved SSLCOMMERZ merchant account and live credentials.
- Never create a payment order from a browser-supplied amount. The server must validate a supplier booking and create the private `travel_orders` row first.
