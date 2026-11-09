create policy "deny public access to travel orders"
on public.travel_orders
for all
to anon, authenticated
using (false)
with check (false);
