-- Correção das políticas executadas manualmente na V3.
-- A tabela app_owner não concede SELECT a authenticated. Uma política com
-- EXISTS (SELECT FROM app_owner) pode falhar com permission denied.
-- A FK owner_documents.owner_id -> app_owner.user_id já garante que o
-- proprietário existe, e auth.uid() garante que é a própria conta.
begin;
drop policy if exists owner_select on public.owner_documents;
drop policy if exists owner_insert on public.owner_documents;
drop policy if exists owner_documents_select_self on public.owner_documents;
drop policy if exists owner_documents_insert_self on public.owner_documents;

create policy owner_select on public.owner_documents
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy owner_insert on public.owner_documents
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and revision = 1);

-- Mantém escrita direta bloqueada: alterações usam RPC com verificação de revisão.
revoke update, delete on public.owner_documents from authenticated;
commit;
