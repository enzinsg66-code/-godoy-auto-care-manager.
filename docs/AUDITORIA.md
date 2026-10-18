# Auditoria inicial — Godoy Auto Care Manager

Data: 18/10/2026. Base examinada: commit `4e5a858` (`index.html` e `LEIA-ME.txt`). As linhas abaixo se referem **à versão original desse commit**, cujo HTML está concentrado em 12 linhas. Podem ser consultadas com `git show 4e5a858:index.html | nl -ba`.

## Escopo e evidência

Foram lidos integralmente os dois arquivos. O repositório original contém um protótipo HTML/CSS/JavaScript executado no navegador, com clientes/veículos, agenda, fichas, despesas e backup JSON no `localStorage`. Não há dependências externas no HTML, autenticação, servidor, banco remoto, manifesto PWA ou service worker. Não havia suíte de testes nem configuração de build.

O `LEIA-ME.txt`, linhas 12–17, descreve explicitamente o uso local, a ausência de sincronização, a restrição a dados fictícios e a diferença entre serviços concluídos e recebimentos. As especificações de conversas anteriores não estão disponíveis neste contexto; o arquivo do repositório é a referência verificável desta etapa. Autenticação, nuvem, publicação e serviços pagos permanecem fora desta execução.

## Constatações no original

| ID | Gravidade | Evidência original | Problema e efeito | Correção recomendada |
| --- | --- | --- | --- | --- |
| A01 | Alta | `index.html`: 3, 5–8 e 11 | A importação verifica somente a existência de quatro arrays. IDs entram sem escape em atributos `data-id`; datas passam por `dateBR()` e entram sem escape no HTML. Um backup manipulado pode criar atributos de evento ou elementos executáveis. | Validar cada registro antes de aceitar o arquivo e escapar todos os valores usados na renderização. Rejeitar o conjunto inteiro se inválido. |
| A02 | Alta | `index.html`: 3, 10–11 | `save()` captura a falha do `localStorage`, mas não informa sucesso/fracasso ao chamador. Os handlers já alteraram `db`, redesenham a tela e, na importação, mostram “Backup importado.” mesmo se a gravação falhar. O usuário pode acreditar que os dados foram salvos e perdê-los ao recarregar. | Gravar uma cópia candidata primeiro; só atualizar o estado e confirmar a ação depois de persistir. Manter os dados e o formulário em caso de falha. |
| A03 | Alta | `index.html`: 3 | JSON local corrompido ou estrutura incompleta é ignorado e substituído em memória por um banco vazio, sem aviso. O próximo cadastro sobrescreve a única cópia local. Falha de leitura também é tratada como instalação nova. | Distinguir ausência de dados de corrupção ou armazenamento indisponível; preservar o conteúdo original e oferecer recuperação/exportação antes de permitir substituição. |
| A04 | Alta | `index.html`: 3, 7 e 11 | Elementos `null`, tipos incorretos, IDs duplicados, referências inexistentes e `steps` inválido passam pela verificação superficial. Um cliente `null` quebra a aba Clientes; uma ficha sem array `steps` quebra Fichas. A versão do backup é ignorada. | Adotar esquema versionado compartilhado entre carga, importação e operações; validar tipos, limites, datas, enums, unicidade e vínculos. Preservar compatibilidade documentada com backups V1 válidos. |
| A05 | Média | `index.html`: 3, 10–11 | Cada aba mantém uma cópia do banco e grava o objeto inteiro. Não há tratamento de `storage` nem comparação da versão persistida. Duas abas abertas podem sobrescrever alterações uma da outra. | Detectar alteração externa antes de gravar e recarregar ou solicitar resolução; impedir sobrescrita silenciosa. |
| A06 | Média | `index.html`: 3–4, 8 e 11; `LEIA-ME.txt`: 17 | `income()` soma preços de serviços concluídos, sem pagamento registrado. O painel chama isso de “Faturamento recebido*”, embora a ressalva e o LEIA-ME expliquem que não confirma recebimento. Valores importados não finitos, negativos ou textuais podem produzir totais incorretos/`NaN`. Valores usam ponto flutuante diretamente. | Usar nomes coerentes para estimativa e recebimento; validar valores e operar em centavos inteiros. Se recebimentos forem implementados, registrar valor/data separadamente da conclusão do atendimento. |
| A07 | Média | `index.html`: 5–9 | Os rótulos dos campos ficam ao lado dos controles sem `for`/`id` nem envolvimento do controle. O input de importação usa `display:none` dentro de um rótulo sem foco. Isso prejudica o nome dos campos em leitores de tela e impede acionar a importação por teclado. | Associar rótulos, manter o upload alcançável pelo teclado, oferecer foco visível e comunicar resultados das ações de modo acessível. |
| A08 | Média | `index.html`: 5–8 e 11 | O navegador aceita campos obrigatórios preenchidos somente com espaços; `val()` depois os transforma em vazio e grava sem revalidar. Não há validação do modelo além dos atributos HTML; vínculos e limites também não são verificados no submit. | Validar o objeto normalizado antes da gravação, com mensagens específicas junto ao formulário. Reaproveitar as mesmas regras na importação. |
| A09 | Baixa | `index.html`: 5–8 e 10 | Cadastros, preços, horários e observações não podem ser corrigidos. A única alternativa disponível é excluir/recriar; excluir um atendimento concluído também altera os indicadores financeiros e remove seu histórico. | Acrescentar edição dos registros e deixar claro o impacto de ações destrutivas. Controles de auditoria permanente dependem de uma etapa posterior. |
| A10 | Baixa | `index.html`: 1–12 | Todo o código está em um único documento com linhas muito extensas e sem testes automatizados. Isso dificulta revisar escape, validações e regressões. | Separar apresentação, regras e persistência, mantendo a execução local simples, e testar os fluxos e as falhas que representam risco de perda de dados. |

### Verificações reproduzidas durante a auditoria

O JavaScript original foi extraído do commit base e executado em uma VM Node com DOM e `localStorage` simulados. Estas verificações confirmam o comportamento das funções; **não equivalem a um teste visual ou de execução de script num navegador**.

1. Um ID com aspas produziu um atributo `onclick` adicional no HTML retornado por `customers()`.
2. A data `2026-10-18<img src=x onerror=alert(1)>` produziu a tag `img` sem escape na tabela da agenda.
3. O armazenamento com `customers: [null]` foi aceito por `load()` e `customers()` lançou `Cannot read properties of null (reading 'name')`.
4. Uma exceção simulada de quota em `localStorage.setItem()` deixou o novo cliente em memória, sem gravação; `save()` somente exibiu alerta.
5. JSON local corrompido carregou um banco vazio sem alerta.
6. Uma despesa importada com `amount: 'texto'` fez `expenses()` retornar `NaN`.

As seis reproduções acima confirmaram os achados. Nenhuma reprodução usou dados reais de clientes ou enviou dados para fora do ambiente.

## Primeira etapa funcional recomendada

Prioridade: tornar confiável o fluxo local descrito no LEIA-ME antes de qualquer publicação.

1. Separar regras/armazenamento da interface e preservar leitura dos registros V1 válidos.
2. Corrigir A01–A04 e A08: validação completa, escape, backup versionado, recuperação segura e gravação atômica do ponto de vista do estado da aplicação.
3. Preservar clientes, agenda, fichas, despesas e exportação/importação. A edição de registros permanece como melhoria posterior, sem bloquear a correção dos riscos de perda de dados desta etapa.
4. Tornar os indicadores financeiros coerentes com a distinção entre serviço concluído e dinheiro recebido. Usar centavos inteiros e limites explícitos.
5. Corrigir os rótulos e o fluxo por teclado; detectar conflito entre abas.
6. Verificar cadastro → agendamento → ficha → conclusão → financeiro → exportação → restauração, incluindo armazenamento sem espaço, backup inválido, conteúdo malicioso, integridade dos vínculos e recarga da página.

## Estado das correções e da validação final

A primeira etapa foi implementada sobre a base local existente, sem serviços externos e sem dependências de produção. A interface mantém a identidade e os módulos originais.

| Achados | Resultado desta etapa |
| --- | --- |
| A01, A04, A08 | `domain.js` valida carga, importação e escrita: registros, tipos, limites, datas reais, horários, enums, IDs, referências e valores monetários. `app.js` escapa os valores inseridos no HTML; fichas usam `textContent`. Campos desconhecidos são descartados. |
| A02 | A alteração ocorre numa cópia; só depois de validar e gravar o estado persistido a interface atualiza e confirma sucesso. A falha preserva o estado anterior e os campos preenchidos. |
| A03 | Corrupção e armazenamento inacessível bloqueiam gravações normais. A aba Dados permite baixar o conteúdo original, tentar nova leitura ou importar/reiniciar com confirmação explícita. A carga não sobrescreve nada. |
| A05 | A aplicação compara o conteúdo persistido antes de gravar e observa eventos de outra aba. A leitura inicial captura o conteúdo e o estado juntos. Conflitos detectados pedem recarga e bloqueiam a escrita. Isso reduz sobrescritas, mas `localStorage` não fornece transações simultâneas entre usuários/processos nem substitui um banco. |
| A06 | Pagamentos independentes, com data e forma, podem ser parciais. Apenas serviços concluídos aceitam pagamento e o total não pode exceder o preço. Cálculos usam centavos inteiros. Painel/Financeiro separam serviços, recebimentos, valores a receber, despesas e saldo de caixa parcial. Atendimento com pagamentos não pode ser excluído antes de remover os pagamentos. |
| A07 | Campos têm rótulos associados, importação recebe foco pelo teclado, navegação informa a aba atual e mensagens usam região de anúncio. Fichas abrem num diálogo com título e botão Fechar. |
| A09 | Pendente: edição, correção de registros e histórico permanente. A exclusão de pagamentos exige confirmação e reabre o valor a receber. |
| A10 | Estrutura em `index.html`, apresentação em `styles.css`, interface em `app.js` e regras em `domain.js`. Testes separados em `tests/`. |

### Migração e restauração

- A chave `godoy_manager_v1` permanece. Dados V1 válidos migram em memória; a próxima gravação usa esquema V2. Não são inventados pagamentos para serviços antigos.
- Backups V1 e V2 são aceitos. V2 exige a coleção de pagamentos e versão correspondente para não apagar informações financeiras por omissão.
- Importação, exportação compacta e gravação compartilham limite de 10 MB em UTF-8. A escrita recusa estados cujo backup ultrapassaria esse limite. A quota do navegador pode ser menor; nesse caso a gravação falha com preservação do estado anterior.
- A revisão encontrou e corrigiu duas regressões antes da entrega: exportações acima do antigo limite de 2 MB e uma segunda leitura na inicialização que podia ignorar alteração concorrente.
- Uma reprodução controlada confirmou que a alteração concorrente durante a inicialização é preservada e a nova gravação bloqueada.

### Validação da versão alterada

- `node tests/domain.test.cjs`: **18 testes aprovados**, incluindo migração, versões, estruturas inválidas, referências, datas, moeda, pagamentos parciais, conteúdo HTML, falhas de leitura/escrita e limites UTF-8. Um backup acima de 2 MB fez ida e volta; dados acima de 10 MB foram rejeitados antes de gravar.
- Sintaxe de `app.js`, `domain.js` e `tests/e2e.cjs`: aprovada por `node --check`.
- `git diff --check`: sem erros.
- `npm run test:e2e`: **14 cenários aprovados no Chromium**, sem exceções JavaScript não tratadas. Cobertura: navegação, cliente/veículo, agenda, conclusão sem recebimento automático, pagamentos parciais e excesso, exclusão protegida, reabertura de saldo ao excluir pagamento, ficha/checklist/diálogo, despesas e recarga, exportação e restauração após apagar dados, HTML inerte, backups inválidos, falha de quota preservando formulário, conflito entre abas, corrupção com cópia original e recuperação, e formulários/navegação em 390 px.
- Na restauração, o banco foi apagado e os totais zerados antes de importar: clientes, agenda, fichas/checklist, duas parcelas totalizando R$ 100 e despesa de R$ 10 foram recuperados e comparados ao estado persistido anterior.
- Capturas de desktop e celular foram inspecionadas. Não houve transbordamento horizontal da página nos módulos testados; tabelas mantêm rolagem própria.
- O Chromium gerenciado bloqueou `file://` com `ERR_BLOCKED_BY_ADMINISTRATOR`. A suíte executa os mesmos quatro arquivos por HTTP em servidor efêmero restrito a `127.0.0.1`, encerrado no `finally`. Abertura direta por arquivo permanece sem verificação neste navegador; a implementação conserva scripts clássicos e não usa módulos/fetch para dados.

### Limites e continuidade

As especificações de conversas anteriores continuam indisponíveis; o escopo implementado se apoia no `LEIA-ME.txt` e nos riscos reproduzidos. Não há autenticação, banco remoto, sincronização entre dispositivos, PWA, múltiplos veículos por cliente, filtros financeiros por período ou edição de registros. Esses itens precisam de definição na próxima etapa. A validação local não equivale a certificação de segurança para operação com dados reais.

Publicação, hospedagem e serviços pagos: **não realizados/configurados**. Os artefatos são código-fonte e testes para execução local.
