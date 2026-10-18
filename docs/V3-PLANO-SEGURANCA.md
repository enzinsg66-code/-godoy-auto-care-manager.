# Godoy Auto Care Manager V3 — Etapa 2

## Objetivo
Acesso exclusivo do proprietário por e-mail e senha, no iPhone e computador, com dados sincronizados. A V2 local permanece funcional na branch `main` até uma migração testada.

## Estado atual
Este commit **não habilita login, nuvem ou sincronização**. Prepara o desenho de segurança e uma primeira migração SQL para avaliação. Não publique o aplicativo atual como se estivesse protegido.

## Arquitetura proposta
- Front-end estático hospedado por HTTPS; instalação PWA somente após manifest, service worker e testes.
- Supabase Auth com e-mail/senha; cadastro público desabilitado depois de provisionar a conta do proprietário.
- Supabase Postgres com Row Level Security (RLS) obrigatória e políticas restritas ao `auth.uid()`.
- O navegador usa apenas chave **publishable/anon**; nunca embutir `service_role`, senhas ou segredos no código.
- Backup JSON local da V2 continua sendo o ponto de recuperação antes de qualquer migração.
- Autenticação não substitui RLS: cada operação de leitura e escrita deve ser autorizada no banco.

## Estratégia de dados (proposta inicial)
A V2 possui um documento validado com `customers`, `appointments`, `inspections`, `expenses` e `payments`. A primeira migração usa um documento JSON por usuário, evitando quebrar vínculos entre essas listas. O front-end deverá validar o documento com `GodoyData.validateData` antes de salvar ou exibir.

**Concorrência:** o banco oferece uma coluna `revision`. A aplicação V3 **deverá** atualizar via função RPC de compare-and-swap (CAS), nunca sobrescrever silenciosamente alterações feitas em outro dispositivo. A migração SQL já fornece a RPC. Recarregar/conciliar quando houver conflito.

## Etapas ainda pendentes
1. Criar projeto Supabase sob controle do proprietário; configurar autenticação, MFA opcional, política de cadastro e URLs permitidas.
2. Executar/revisar a migração SQL; verificar RLS com duas contas de teste (uma não pode ler a outra).
3. Implementar cliente de autenticação e estado de sessão; impedir que o app mostre dados antes da sessão válida.
4. Implementar leitura, gravação CAS, tratamento de conflito, estados offline/erro e sincronização.
5. Criar interface de migração **explícita** a partir de backup V2, com prévia, validação e confirmação; nunca importar silenciosamente dados do `localStorage`.
6. Configurar HTTPS, PWA e testes em iPhone + computador, incluindo logout, sessão expirada e restauração.
7. Fazer PR e revisão de segurança antes de qualquer merge.

## Cuidados
- Não há sincronização offline automática implementada.
- O projeto/repositório GitHub pode ser público: nunca commitar credenciais ou backups de clientes.
- Em dispositivos compartilhados, sair da conta; limpar caches sensíveis no logout.
- A migração de dados reais exige backup verificado e autorização explícita.
