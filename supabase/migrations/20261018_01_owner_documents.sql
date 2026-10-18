-- V3 / primeira proposta de esquema. Executar somente após revisão no projeto Supabase do proprietário.
create table if not exists public.owner_documents (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint owner_documents_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint owner_documents_payload_size check (octet_length(payload::text) <= 10000000)
);

alter table public.owner_documents enable row level security;

revoke all on public.owner_documents from anon;
grant select, insert on public.owner_documents to authenticated;
-- Updates are only allowed through the CAS RPC (not direct table updates).
revoke update, delete on public.owner_documents from authenticated;

drop policy if exists owner_documents_select_self on public.owner_documents;
create policy owner_documents_select_self on public.owner_documents
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists owner_documents_insert_self on public.owner_documents;
create policy owner_documents_insert_self on public.owner_documents
  for insert to authenticated with check (owner_id = (select auth.uid()) and revision = 1);

-- CAS function: fails on stale revision. SECURITY INVOKER honors RLS; temporarily
-- grant UPDATE only inside a security-definer function is not possible, so this
-- SECURITY DEFINER function checks auth.uid() explicitly and uses fixed search_path.
create or replace function public.update_owner_document(
  expected_revision bigint,
  new_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_revision bigint;
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'Autenticação necessária';
  end if;
  if new_payload is null or jsonb_typeof(new_payload) <> 'object'
     or octet_length(new_payload::text) > 10000000 then
    raise exception 'Documento inválido';
  end if;
  if expected_revision is null or expected_revision < 1 then
    raise exception 'Revisão inválida';
  end if;

  update public.owner_documents
     set payload = new_payload,
         revision = revision + 1,
         updated_at = now()
   where owner_id = caller and revision = expected_revision
   returning revision into new_revision;

  if new_revision is null then
    raise exception 'Conflito de versão ou documento inexistente';
  end if;
  return new_revision;
end;
$$;

revoke all on function public.update_owner_document(bigint, jsonb) from public;
revoke all on function public.update_owner_document(bigint, jsonb) from anon;
grant execute on function public.update_owner_document(bigint, jsonb) to authenticated;

-- Nota: para o primeiro documento, INSERT é permitido só para o próprio usuário.
-- A aplicação deve inserir o documento inicial com revision=1 e tratar erro de duplicidade.
