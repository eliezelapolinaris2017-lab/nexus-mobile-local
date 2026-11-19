alter table public.nova_confirmation_owners add column if not exists owner_id uuid unique references auth.users(id) on delete restrict;
