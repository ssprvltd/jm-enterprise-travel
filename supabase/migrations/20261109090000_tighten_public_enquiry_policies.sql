-- Tighten anonymous enquiry inserts and explicitly scope public package reads.
drop policy if exists "Public can submit booking enquiries" on public.booking_enquiries;
create policy "Public can submit booking enquiries"
on public.booking_enquiries
for insert to anon, authenticated
with check (
  length(trim(enquiry_type)) between 1 and 40
  and (from_location is null or length(from_location) <= 120)
  and (destination is null or length(destination) <= 120)
  and (travellers is null or length(travellers) <= 10)
);

drop policy if exists "Public can submit contact enquiries" on public.contact_enquiries;
create policy "Public can submit contact enquiries"
on public.contact_enquiries
for insert to anon, authenticated
with check (
  length(trim(name)) between 1 and 100
  and length(trim(phone)) between 5 and 30
  and length(trim(message)) between 1 and 3000
);

drop policy if exists "Public can view active packages" on public.travel_packages;
create policy "Public can view active packages"
on public.travel_packages
for select to anon, authenticated
using (is_active = true);

create policy "Legacy travel packages deny public access"
on public."Travel Packages"
for all to anon, authenticated
using (false)
with check (false);
