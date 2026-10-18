/* Run: node tests/e2e.cjs. Serves only the four public app files on an ephemeral loopback port. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const http = require('node:http');
const path = require('node:path');
let playwright;
try { playwright = require('playwright'); }
catch (_) { playwright = require('/opt/codex/cua_node/lib/node_modules/playwright'); }
const { chromium } = playwright;

const appRoot = path.resolve(__dirname, '..');
const money = amount => amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\s/g, ' ');
const customerName = 'Cliente de teste E2E';
const pageErrors = [];
let passed = 0;

async function step(name, action) {
  await action();
  passed += 1;
  console.log(`OK ${passed}: ${name}`);
}

async function visibleText(page, pattern) {
  await page.getByText(pattern).first().waitFor({ state: 'visible' });
}

async function nav(page, name) {
  const desktop = page.getByRole('navigation', { name: 'Navegação principal', exact: true });
  const mobile = page.getByRole('navigation', { name: 'Navegação móvel', exact: true });
  const active = await desktop.isVisible() ? desktop : mobile;
  await active.getByRole('button', { name, exact: true }).click();
}

async function fill(form, label, value) {
  await form.getByLabel(label).fill(value);
}

async function submit(form) {
  await form.locator('button[type="submit"]').click();
}

async function checkMoneyCard(page, label, amount) {
  const card = page.locator('.card').filter({ has: page.locator('.metric-label', { hasText: label }) });
  assert.equal(await card.count(), 1, `Expected one financial card matching ${label}`);
  assert.equal((await card.locator('strong').innerText()).replace(/\s/g, ' '), money(amount));
}

async function storageSnapshot(page) {
  return page.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
}

async function checkLabels(page) {
  const missing = await page.locator('input:not([type="hidden"]), select, textarea').evaluateAll(controls =>
    controls.filter(control => {
      if (!control.getClientRects().length) return false;
      return !(control.labels?.length || control.getAttribute('aria-label')?.trim() ||
        control.getAttribute('aria-labelledby')?.trim());
    }).map(control => control.outerHTML)
  );
  assert.deepEqual(missing, [], 'Every visible form control must have an accessible label');
}

async function main() {
  const files = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
    ['/domain.js', ['domain.js', 'text/javascript; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
  ]);
  const server = http.createServer(async (request, response) => {
    const file = files.get(new URL(request.url, 'http://127.0.0.1').pathname);
    if (!['GET', 'HEAD'].includes(request.method) || !file) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      const content = await fs.readFile(path.join(appRoot, file[0]));
      response.writeHead(200, { 'Content-Type': file[1], 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (_) {
      response.writeHead(500);
      response.end();
    }
  });
  let browser;
  let context;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const appURL = `http://127.0.0.1:${server.address().port}/index.html`;
    const executablePath = process.env.GODOY_BROWSER || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
    browser = await chromium.launch({
      ...(executablePath ? { executablePath } : {}),
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    console.log('INFO: preview HTTP apenas em 127.0.0.1; file:// não verificado por esta suíte.');
    await page.goto(appURL);
    await step('Abre o preview local e oferece navegação acessível', async () => {
      await page.getByRole('navigation', { name: 'Navegação principal', exact: true }).waitFor();
      assert.equal(await page.title(), 'Godoy Auto Care Manager');
      assert.deepEqual(pageErrors, []);
    });

    await step('Cadastra cliente fictício com veículo', async () => {
      await nav(page, 'Clientes');
      const form = page.locator('#customerForm');
      await checkLabels(page);
      await fill(form, /Nome/, customerName);
      await fill(form, /Telefone|WhatsApp/, '65999990000');
      await fill(form, /Veículo|Modelo/, 'Hatch de teste');
      await fill(form, /Placa/, 'TST1A23');
      await submit(form);
      await visibleText(page, customerName);
      await visibleText(page, 'TST1A23');
    });

    await step('Agenda serviço e registra conclusão sem confundir com recebimento', async () => {
      await nav(page, 'Agenda');
      const form = page.locator('#appointmentForm');
      await checkLabels(page);
      await form.getByLabel(/Cliente/).selectOption({ index: 0 });
      await form.getByLabel(/Serviço/).selectOption({ label: 'Lavagem externa' });
      await fill(form, /^Data|Data do/, '2026-10-20');
      await fill(form, /Horário|Hora/, '10:00');
      await fill(form, /Valor/, '100.00');
      await submit(form);
      const serviceRow = page.getByRole('row').filter({ hasText: 'Lavagem externa' });
      await serviceRow.getByRole('button', { name: /Concluir/ }).click();
      await nav(page, 'Financeiro');
      await checkMoneyCard(page, /recebidos/i, 0);
      await checkMoneyCard(page, /Serviços concluídos|Faturamento/, 100);
    });

    await step('Aceita pagamentos parciais e impede pagamento acima do saldo', async () => {
      const form = page.locator('#paymentForm');
      await checkLabels(page);
      await form.getByLabel(/Atendimento|Agendamento|Serviço/).selectOption({ index: 0 });
      await fill(form, /Valor/, '40.00');
      await form.getByLabel(/Forma|Método/).selectOption({ label: 'Pix' });
      await submit(form);
      await checkMoneyCard(page, /recebidos/i, 40);
      await form.getByLabel(/Atendimento|Agendamento|Serviço/).selectOption({ index: 0 });
      await fill(form, /Valor/, '61.00');
      await form.getByLabel(/Forma|Método/).selectOption({ label: 'Dinheiro' });
      await submit(form);
      await checkMoneyCard(page, /recebidos/i, 40);
      await fill(form, /Valor/, '60.00');
      await submit(form);
      await checkMoneyCard(page, /recebidos/i, 100);
    });

    await step('Protege atendimento pago e excluir pagamento reabre o saldo a receber', async () => {
      await nav(page, 'Agenda');
      const before = await storageSnapshot(page);
      await page.getByRole('row').filter({ hasText: 'Lavagem externa' }).getByRole('button', { name: 'Excluir', exact: true }).click();
      await visibleText(page, /atendimento tem pagamentos vinculados/);
      assert.deepEqual(await storageSnapshot(page), before, 'A paid appointment cannot be removed');
      await nav(page, 'Financeiro');
      await page.getByRole('row').filter({ hasText: 'Dinheiro' }).getByRole('button', { name: 'Excluir', exact: true }).click();
      await checkMoneyCard(page, /recebidos/i, 40);
      await checkMoneyCard(page, /^A receber$/, 60);
      const form = page.locator('#paymentForm');
      await fill(form, /Valor/, '60.00');
      await form.getByLabel(/Forma/).selectOption({ label: 'Dinheiro' });
      await submit(form);
      await checkMoneyCard(page, /recebidos/i, 100);
      await checkMoneyCard(page, /^A receber$/, 0);
    });

    await step('Registra e visualiza ficha com checklist e observações', async () => {
      await nav(page, 'Fichas');
      const form = page.locator('#inspectionForm');
      await checkLabels(page);
      await form.getByLabel(/Cliente/).selectOption({ index: 0 });
      await fill(form, /^Data/, '2026-10-20');
      await form.getByLabel(/Nível de sujeira/).selectOption({ label: 'Normal' });
      await fill(form, /V-Floc/, '20');
      await fill(form, /Início/, '10:00');
      await fill(form, /Fim/, '11:00');
      await form.getByRole('checkbox', { name: /Inspeção inicial/ }).check();
      await form.getByRole('checkbox', { name: 'Inspeção final', exact: true }).check();
      await fill(form, /Observações/, 'Observação fictícia: risco já existente.');
      await submit(form);
      await page.getByRole('button', { name: 'Ver', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible' });
      assert.match(await dialog.innerText(), /Observação fictícia: risco já existente\./);
      assert.match(await dialog.innerText(), /20 mL/);
      await dialog.getByRole('button', { name: 'Fechar', exact: true }).click();
      assert.equal(await dialog.isVisible(), false);
    });

    await step('Registra despesa e preserva dados ao recarregar', async () => {
      await nav(page, 'Financeiro');
      const form = page.locator('#expenseForm');
      await fill(form, /Descrição/, 'Material de teste');
      await fill(form, /Valor/, '10.00');
      await submit(form);
      await checkMoneyCard(page, /Despesas/, 10);
      await page.screenshot({ path: '/tmp/godoy-desktop.png', fullPage: true });
      await page.reload();
      await nav(page, 'Financeiro');
      await checkMoneyCard(page, /recebidos/i, 100);
      await checkMoneyCard(page, /Despesas/, 10);
    });

    let exported;
    await step('Exporta backup JSON e importa novamente sem perder registros', async () => {
      await nav(page, 'Dados');
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: /Baixar backup|Exportar backup/ }).click();
      const download = await downloading;
      exported = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
      assert.ok(JSON.stringify(exported).includes(customerName), 'Backup includes the customer');
      const before = await storageSnapshot(page);
      assert.equal(exported.data.inspections.length, 1);
      assert.equal(exported.data.inspections[0].steps.length, 2);
      await page.getByRole('button', { name: 'Apagar todos os dados', exact: true }).click();
      await visibleText(page, 'Dados locais apagados.');
      await nav(page, 'Clientes');
      assert.equal(await page.getByRole('row').filter({ hasText: customerName }).count(), 0);
      await nav(page, 'Financeiro');
      await checkMoneyCard(page, /recebidos/i, 0);
      await checkMoneyCard(page, /Serviços concluídos/, 0);
      await checkMoneyCard(page, /Despesas/, 0);
      await nav(page, 'Dados');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'backup-teste.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))
      });
      await visibleText(page, 'Backup importado e salvo neste navegador.');
      assert.deepEqual(await storageSnapshot(page), before, 'Restoration after deleting all records preserves every collection');
      await nav(page, 'Financeiro');
      await checkMoneyCard(page, /recebidos/i, 100);
      await checkMoneyCard(page, /Despesas/, 10);
      await checkMoneyCard(page, /^A receber$/, 0);
      await nav(page, 'Clientes');
      await visibleText(page, customerName);
    });

    await step('Escapa HTML e IDs especiais importados sem executar ou injetar atributos', async () => {
      await nav(page, 'Dados');
      const payload = structuredClone(exported);
      const record = payload.data.expenses[0];
      assert.ok(record, 'Backup contains identifiable records');
      record.id = '\"><img src=x onerror="window.__godoyInjected=true">';
      record.description = '<script>window.__godoyInjected=true</script>';
      await page.locator('input[type="file"]').setInputFiles({
        name: 'backup-malicioso.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload))
      });
      await visibleText(page, 'Backup importado e salvo neste navegador.');
      await nav(page, 'Financeiro');
      assert.equal(await page.evaluate(() => window.__godoyInjected), undefined);
      assert.equal(await page.locator('img[src="x"], script:not([src])').count(), 0);
      const row = page.getByRole('row').filter({ hasText: record.description });
      assert.equal(await row.count(), 1, 'HTML is displayed as literal text');
      assert.equal(await row.getByRole('button', { name: 'Excluir', exact: true }).getAttribute('data-id'), record.id);
      await row.getByRole('button', { name: 'Excluir', exact: true }).click();
      await checkMoneyCard(page, /Despesas/, 0);
      await nav(page, 'Dados');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'backup-limpo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))
      });
      await visibleText(page, 'Backup importado e salvo neste navegador.');
    });

    await step('Rejeita backups de estrutura e datas inválidas sem perder registros', async () => {
      const before = await storageSnapshot(page);
      const payload = structuredClone(exported);
      payload.data.expenses[0].date = '2026-02-30';
      payload.data.expenses[0].id = '\"><img src=x onerror="window.__godoyInjected=true">';
      await page.locator('input[type="file"]').setInputFiles({
        name: 'backup-data-invalida.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload))
      });
      await visibleText(page, /data inexistente/);
      assert.deepEqual(await storageSnapshot(page), before, 'Invalid data leaves storage intact');
      assert.equal(await page.evaluate(() => window.__godoyInjected), undefined);
      await page.locator('input[type="file"]').setInputFiles({
        name: 'backup-quebrado.json', mimeType: 'application/json', buffer: Buffer.from('{not valid JSON')
      });
      await visibleText(page, /JSON inválido/);
      assert.deepEqual(await storageSnapshot(page), before, 'Malformed JSON leaves storage intact');
      const overpayment = structuredClone(exported);
      overpayment.data.payments[0].amount = 101;
      await page.locator('input[type="file"]').setInputFiles({
        name: 'backup-pagamento-excessivo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(overpayment))
      });
      await visibleText(page, /pagamentos excedem/);
      assert.deepEqual(await storageSnapshot(page), before, 'Overpayment in a backup leaves storage intact');
    });

    await step('Falha de gravação não cria um cliente fantasma nem perde dados existentes', async () => {
      await nav(page, 'Clientes');
      const before = await storageSnapshot(page);
      await page.evaluate(() => {
        window.__originalSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function () { throw new DOMException('Quota de teste', 'QuotaExceededError'); };
      });
      const form = page.locator('#customerForm');
      await fill(form, /Nome/, 'Cliente que não deve ser salvo');
      await fill(form, /Telefone|WhatsApp/, '65999991111');
      await fill(form, /Veículo|Modelo/, 'Veículo não salvo');
      await fill(form, /Placa/, 'ERR1A23');
      await submit(form);
      await visibleText(page, /Não foi possível salvar/);
      assert.equal(await page.getByRole('row').filter({ hasText: 'Cliente que não deve ser salvo' }).count(), 0);
      assert.equal(await form.getByLabel(/Nome/).inputValue(), 'Cliente que não deve ser salvo', 'Unsaved input remains available to retry');
      assert.deepEqual(await storageSnapshot(page), before);
      await page.evaluate(() => { Storage.prototype.setItem = window.__originalSetItem; });
      await page.reload();
      await nav(page, 'Clientes');
      assert.equal(await page.getByRole('row').filter({ hasText: 'Cliente que não deve ser salvo' }).count(), 0);
      await visibleText(page, customerName);
    });

    await step('Alteração em outra aba bloqueia sobrescrita e recarregar recupera os dados atuais', async () => {
      await nav(page, 'Clientes');
      const second = await context.newPage();
      second.setDefaultTimeout(10000);
      second.on('pageerror', error => pageErrors.push(error.message));
      try {
        await second.goto(appURL);
        await nav(second, 'Clientes');
        const form = second.locator('#customerForm');
        await fill(form, /Nome/, 'Cliente da segunda aba');
        await fill(form, /Veículo/, 'Veículo fictício da segunda aba');
        await submit(form);
        await visibleText(second, 'Cliente da segunda aba');
        await page.locator('#storageNotice').filter({ hasText: /outra aba/ }).waitFor({ state: 'visible' });
        assert.equal(await page.locator('#customerForm button[type="submit"]').isDisabled(), true);
        await page.reload();
        await nav(page, 'Clientes');
        await visibleText(page, 'Cliente da segunda aba');
        await visibleText(page, customerName);
        assert.equal(await page.locator('#customerForm button[type="submit"]').isDisabled(), false);
      } finally { await second.close(); }
    });

    await step('Dados locais corrompidos bloqueiam gravação, permitem cópia original e restauração', async () => {
      const key = Object.keys(await storageSnapshot(page))[0];
      assert.ok(key, 'The application has persisted data');
      const recoveryContext = await browser.newContext({ acceptDownloads: true });
      try {
        const recoveryPage = await recoveryContext.newPage();
        recoveryPage.setDefaultTimeout(10000);
        recoveryPage.on('pageerror', error => pageErrors.push(error.message));
        recoveryPage.on('dialog', dialog => dialog.accept());
        await recoveryPage.goto(appURL);
        const corrupt = '{dados-corrompidos-de-teste';
        await recoveryPage.evaluate(({ key, corrupt }) => localStorage.setItem(key, corrupt), { key, corrupt });
        await recoveryPage.reload();
        await recoveryPage.locator('#storageNotice').filter({ hasText: /gravações estão bloqueadas/ }).waitFor({ state: 'visible' });
        await nav(recoveryPage, 'Clientes');
        assert.equal(await recoveryPage.locator('#customerForm button[type="submit"]').isDisabled(), true);
        assert.equal(await recoveryPage.evaluate(key => localStorage.getItem(key), key), corrupt);
        await nav(recoveryPage, 'Dados');
        const downloading = recoveryPage.waitForEvent('download');
        await recoveryPage.getByRole('button', { name: 'Baixar conteúdo original', exact: true }).click();
        const original = await downloading;
        assert.equal(await fs.readFile(await original.path(), 'utf8'), corrupt, 'Recovery export preserves the original bytes');
        await recoveryPage.locator('input[type="file"]').setInputFiles({
          name: 'backup-recuperacao.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported))
        });
        await visibleText(recoveryPage, 'Backup importado e salvo neste navegador.');
        await nav(recoveryPage, 'Clientes');
        await visibleText(recoveryPage, customerName);
        assert.equal(await recoveryPage.locator('#customerForm button[type="submit"]').isDisabled(), false);
        await nav(recoveryPage, 'Financeiro');
        await checkMoneyCard(recoveryPage, /recebidos/i, 100);
        await checkMoneyCard(recoveryPage, /Despesas/, 10);
      } finally { await recoveryContext.close(); }
    });

    await step('Navegação e formulários funcionam na largura móvel de 390 px', async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await page.getByRole('navigation', { name: 'Navegação principal', exact: true }).isVisible(), false);
      assert.equal(await page.getByRole('navigation', { name: 'Navegação móvel', exact: true }).isVisible(), true);
      for (const section of ['Clientes', 'Agenda', 'Fichas', 'Financeiro', 'Dados']) {
        await nav(page, section);
        await checkLabels(page);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true,
          `${section} should not overflow the mobile viewport`);
      }
      await nav(page, 'Clientes');
      await page.screenshot({ path: '/tmp/godoy-mobile.png', fullPage: true });
      assert.deepEqual(pageErrors, [], 'Browser reports no uncaught JavaScript exceptions');
    });
    console.log(`\n${passed} testes E2E aprovados. Contexto de navegador isolado; somente dados fictícios.`);
  } finally {
    try { await context?.close(); }
    finally {
      try { await browser?.close(); }
      finally { await new Promise(resolve => server.close(resolve)); }
    }
  }
}

main().catch(error => {
  console.error(`\nFALHA após ${passed} testes aprovados: ${error.stack || error}`);
  process.exitCode = 1;
});
