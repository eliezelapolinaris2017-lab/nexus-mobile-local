-- Apply ONLY to the new independent NOVA Supabase project.
create table public.nova_confirmation_owners (
  key_hash text primary key check (key_hash ~ '^[a-f0-9]{64}$'),
  active boolean not null default true
);
create table public.nova_confirmation_invites (
  id uuid primary key,
  owner_hash text not null references public.nova_confirmation_owners(key_hash),
  token_hash text unique not null check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index nova_invites_owner_idx on public.nova_confirmation_invites(owner_hash);
alter table public.nova_confirmation_owners enable row level security;
alter table public.nova_confirmation_invites enable row level security;
revoke all on public.nova_confirmation_owners,public.nova_confirmation_invites from public,anon,authenticated;
grant select,insert,update on public.nova_confirmation_owners,public.nova_confirmation_invites to service_role;
-- Provision owner by generating a random 32-byte hex password privately, hashing with SHA-256, and inserting only hash.
-- Never add the password to this file or GitHub. No customer name, phone, address or invoice is stored here.
