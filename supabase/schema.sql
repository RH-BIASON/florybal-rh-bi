-- Florybal RH BI - Supabase schema
-- Run this in the Supabase SQL editor before enabling the app with SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

create extension if not exists pgcrypto;

create table if not exists public.payroll_imports (
  id text primary key,
  status text not null check (status in ('imported', 'blocked', 'failed')),
  imported_at timestamptz not null default now(),
  generated_at timestamptz,
  detail text not null default '',
  source_files jsonb not null default '[]'::jsonb,
  periods text[] not null default '{}',
  branch_count integer not null default 0,
  employee_records integer not null default 0,
  reconciliation_matched boolean not null default false,
  unclassified_event_count integer not null default 0,
  diagnostic_count integer not null default 0,
  quality jsonb,
  dataset jsonb
);

create table if not exists public.payroll_import_files (
  id uuid primary key default gen_random_uuid(),
  import_id text not null references public.payroll_imports(id) on delete cascade,
  original_name text not null,
  stored_name text not null,
  storage_bucket text not null default 'payroll-pdfs',
  storage_path text,
  sha256 text,
  size_bytes bigint,
  created_at timestamptz not null default now()
);

create table if not exists public.payroll_records (
  id text primary key,
  import_id text not null references public.payroll_imports(id) on delete cascade,
  source_file text not null,
  source_page integer,
  period_key text not null,
  period_label text not null,
  period_start date,
  period_end date,
  branch_code text not null,
  branch_name text not null,
  branch_label text not null,
  contract text not null,
  employee_name text not null,
  job_title text,
  admission_date date,
  resignation_date date,
  gross numeric(14,2) not null default 0,
  discounts numeric(14,2) not null default 0,
  net numeric(14,2) not null default 0,
  salary numeric(14,2) not null default 0,
  overtime_hours numeric(12,2) not null default 0,
  overtime_value numeric(14,2) not null default 0,
  absence_hours numeric(12,2) not null default 0,
  absence_value numeric(14,2) not null default 0,
  variables_value numeric(14,2) not null default 0,
  loans_value numeric(14,2) not null default 0,
  vacation_start date,
  vacation_end date,
  vacation_days integer,
  vacation_cost numeric(14,2) not null default 0,
  charges jsonb not null default '{}'::jsonb,
  validation jsonb not null default '[]'::jsonb,
  raw jsonb not null
);

create table if not exists public.payroll_events (
  id bigserial primary key,
  import_id text not null references public.payroll_imports(id) on delete cascade,
  payroll_record_id text not null references public.payroll_records(id) on delete cascade,
  source_file text not null,
  source_page integer,
  period_key text not null,
  branch_code text not null,
  contract text not null,
  employee_name text not null,
  code text not null,
  description text not null,
  quantity numeric(14,2),
  value numeric(14,2) not null default 0,
  event_group text,
  kind text,
  raw jsonb not null
);

create table if not exists public.payroll_audit_results (
  import_id text primary key references public.payroll_imports(id) on delete cascade,
  created_at timestamptz not null default now(),
  reconciliation jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '[]'::jsonb,
  unclassified_events jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb
);

create index if not exists idx_payroll_imports_status_date on public.payroll_imports(status, imported_at desc);
create index if not exists idx_payroll_records_import_period on public.payroll_records(import_id, period_key);
create index if not exists idx_payroll_records_import_branch on public.payroll_records(import_id, branch_code);
create index if not exists idx_payroll_records_employee on public.payroll_records(import_id, employee_name);
create index if not exists idx_payroll_events_import_code on public.payroll_events(import_id, code);
create index if not exists idx_payroll_events_import_group on public.payroll_events(import_id, event_group);

insert into storage.buckets (id, name, public)
values ('payroll-pdfs', 'payroll-pdfs', false)
on conflict (id) do nothing;

-- Optional hardening for client-side reads later. The current backend uses the service role key.
alter table public.payroll_imports enable row level security;
alter table public.payroll_import_files enable row level security;
alter table public.payroll_records enable row level security;
alter table public.payroll_events enable row level security;
alter table public.payroll_audit_results enable row level security;
