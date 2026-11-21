# J M Enterprise API integration

## Deployed Supabase Edge Functions
- `amadeus-flight-search`: Amadeus flight-offer search proxy. Defaults to test mode; production search is selected only when the server-side `AMADEUS_MODE=production` secret is set and production credentials are configured.
- `hotelbeds-search` and `hotelbeds-catalog-sync`: Hotelbeds Evaluation/Test integration only.
- `payment-initiate` and `payment-ipn`: SSLCOMMERZ checkout initiation and server-side IPN validation. A trusted booking/order-creation flow is still required.

## Required Edge Function secrets
Set secrets in Supabase Dashboard → Edge Functions → Secrets. Never commit them to GitHub, browser code, or public messages.

### Amadeus test
- `AMADEUS_API_KEY`
- `AMADEUS_API_SECRET`

### Amadeus production (only after provider approval)
- `AMADEUS_MODE=production`
- `AMADEUS_PRODUCTION_API_KEY`
- `AMADEUS_PRODUCTION_API_SECRET`

If `AMADEUS_MODE` is not exactly `production`, the function uses the Amadeus test endpoint. Production credentials are separate from test credentials. The search function returns flight offers only; `live_booking: false` means it does not issue tickets or confirm reservations.

### Hotelbeds Evaluation/Test
- `HOTELBEDS_API_KEY`
- `HOTELBEDS_API_SECRET`
- The current deployed Hotelbeds search function calls `https://api.test.hotelbeds.com/hotel-api/1.0/hotels`.
- Catalog sync also requires Supabase server-side `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables.

The Hotelbeds functions currently require a valid Supabase JWT. The public website does not call these functions directly; the Hotel tab is an enquiry form, not live inventory search or booking.

### Tripgic sandbox (legacy integration)
- `TRIPGIC_API_KEY`
- `TRIPGIC_SECRET_CODE`
- `TRIPGIC_PARTNER_ID`
- `TRIPGIC_BASE_URL=https://sandbox.api.tripgic.com/v1`

### SSLCOMMERZ sandbox
- `SSLCOMMERZ_STORE_ID`
- `SSLCOMMERZ_STORE_PASSWORD`
- `SSLCOMMERZ_MODE=sandbox`

For live payments, an approved SSLCOMMERZ merchant account and live credentials are required, with `SSLCOMMERZ_MODE=live`.

## Website behavior and limitations
- Public flight search calls `amadeus-flight-search`. The function reports whether it is in `test` or `production` mode. A production search requires the production secrets above.
- Flight search results are offers only. They are not a ticket, held fare, or confirmed booking.
- Hotel tab collects destination, dates, room/guest counts and contact details, saves an enquiry to `contact_enquiries`, and opens WhatsApp. It does not search live Hotelbeds inventory or confirm a hotel reservation.
- Holiday package and visa requests remain enquiry workflows.
- The official J M Enterprise logo is embedded in the website.

## Booking and payment security requirements
- `travel_orders` is private to server-side service-role operations. The public browser must not read or create payment orders.
- A trusted server-side booking step must validate supplier availability/fare and create a `travel_orders` row before payment is initiated.
- `payment-initiate` must accept only an existing server-created `order_ref`; it must never trust an amount supplied by the browser.
- `payment-ipn` must validate the SSLCOMMERZ notification server-to-server before an order is marked paid. A browser redirect alone never confirms payment.
- Never expose Amadeus, Hotelbeds, Tripgic, SSLCOMMERZ, or Supabase service-role secrets in frontend code.
- Do not claim live booking/payment is enabled until provider approval, production credentials, and end-to-end tests are verified.

## Current verified deployment status (reviewed 2026-11-21)
- GitHub Pages deployment workflow is configured for pushes to `main` and manual runs.
- Supabase project is healthy; the seven deployed Edge Functions report `ACTIVE`.
- `amadeus-flight-search` is deployed at version 5 and includes a production-mode switch.
- Supabase Security Advisor and Health Advisor returned no lint findings during this review.
- Live provider credentials and end-to-end supplier/payment transactions have not been verified by this repository check.
