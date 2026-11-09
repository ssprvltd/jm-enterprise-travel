create table if not exists public.travel_orders (
  id uuid primary key default gen_random_uuid(),
  order_ref text not null unique,
  customer_name text not null,
  customer_email text,
  customer_phone text not null,
  description text not null default 'Travel booking',
  amount_bdt numeric(12,2) not null check (amount_bdt >= 10 and amount_bdt <= 500000),
  currency text not null default 'BDT' check (currency = 'BDT'),
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','paid','payment_failed','cancelled')),
  ssl_tran_id text unique,
  ssl_val_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.travel_orders enable row level security;
revoke all on table public.travel_orders from anon, authenticated;
grant all on table public.travel_orders to service_role;
