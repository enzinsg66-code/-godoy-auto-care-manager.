'use strict';

// Script clássico: o protótipo continua funcionando ao abrir index.html diretamente.
const D = window.GodoyData;
const steps = D.STEPS;
const tabs = [
  ['dashboard', '◫', 'Painel'], ['appointments', '▦', 'Agenda'],
  ['customers', '♙', 'Clientes'], ['inspections', '☑', 'Fichas'],
  ['finance', '＄', 'Financeiro'], ['settings', '⚙', 'Dados']
];
let storage;
try { storage = window.localStorage; } catch (_) { /* read() relata indisponibilidade. */ }
// Capture o conteúdo e o estado na mesma leitura, inclusive entre duas abas.
let lastRaw;
const initial = D.read(storage && {
  getItem(key) {
    lastRaw = storage.getItem(key);
    return lastRaw;
  }
});
let db = initial.data;
let blocked = initial.blocked;
let storageError = initial.error;
let conflict = false;
let page = 'dashboard';

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function dateBR(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}
function id() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function val(form, key) { return form.elements[key]?.value?.trim() || ''; }
function customerName(customerId) { return db.customers.find(c => c.id === customerId)?.name || 'Cliente indisponível'; }
function completed() { return db.appointments.filter(a => a.status === 'Concluído'); }
function paidCents(appointmentId) {
  return db.payments.filter(p => p.appointmentId === appointmentId).reduce((sum, p) => sum + D.cents(p.amount), 0);
}
function remaining(appointment) { return (D.cents(appointment.price) - paidCents(appointment.id)) / 100; }
function empty(text) { return `<div class="empty">${esc(text)}</div>`; }
function card(label, value) { return `<div class="card"><span class="metric-label">${esc(label)}</span><strong>${esc(value)}</strong></div>`; }
function field(name, label, input, full = false) {
  return `<div class="field${full ? ' full' : ''}"><label for="field-${name}">${esc(label)}</label>${input.replace('<input ', `<input id="field-${name}" `).replace('<select ', `<select id="field-${name}" `).replace('<textarea ', `<textarea id="field-${name}" `)}</div>`;
}
function input(name, label, attributes = '') { return field(name, label, `<input name="${name}" ${attributes}>`); }
function options(values) { return values.map(v => `<option>${esc(v)}</option>`).join(''); }
function customerOptions() { return db.customers.map(c => `<option value="${esc(c.id)}">${esc(c.name)} — ${esc(c.vehicle)}</option>`).join(''); }
function formAction(label) { return `<div class="field full"><button class="btn" type="submit">${label}</button></div>`; }
function removeButton(action, ref, label = 'Excluir') {
  return `<button class="btn small danger" data-action="${action}" data-id="${esc(ref)}" data-mutates>${label}</button>`;
}
function feedback(message, error = false) {
  const node = document.getElementById('feedback');
  node.textContent = message;
  node.classList.toggle('hidden', !message);
  node.classList.toggle('error', error);
}
function renderStorageNotice() {
  const node = document.getElementById('storageNotice');
  node.textContent = conflict
    ? 'Os dados foram alterados em outra aba. Recarregue esta página antes de salvar para evitar sobrescrever registros.'
    : blocked ? `${storageError} As gravações estão bloqueadas para preservar os dados. Abra Dados para recuperar ou importar um backup.` : '';
  node.classList.toggle('hidden', !blocked && !conflict);
  document.querySelectorAll('form button[type="submit"], [data-mutates]').forEach(button => {
    button.disabled = blocked || conflict;
  });
}

// A memória e a interface só avançam depois de uma gravação válida e bem-sucedida.
function persist(next, recovery = false) {
  if (conflict) throw Error('Recarregue a página: os dados mudaram em outra aba.');
  if (blocked && !recovery) throw Error('Gravação bloqueada. Recupere os dados na aba Dados.');
  if (storage.getItem(D.KEY) !== lastRaw) {
    conflict = true;
    renderStorageNotice();
    throw Error('Os dados mudaram em outra aba. Recarregue antes de salvar.');
  }
  const saved = D.write(storage, next);
  db = saved;
  lastRaw = JSON.stringify(saved);
  blocked = false;
  storageError = null;
}
function transaction(change, message) {
  try {
    const next = JSON.parse(JSON.stringify(db));
    change(next);
    persist(next);
    render();
    feedback(message);
    return true;
  } catch (error) {
    feedback(`Não foi possível salvar: ${error.message}`, true);
    return false;
  }
}
function setPage(nextPage) {
  if (!tabs.some(([key]) => key === nextPage)) return;
  page = nextPage;
  feedback('');
  render();
  window.scrollTo(0, 0);
  document.getElementById('pageTitle').focus({ preventScroll: true });
}
function nav() {
  for (const target of ['desktopNav', 'mobileNav']) {
    document.getElementById(target).innerHTML = tabs.map(([key, icon, label]) =>
      `<button class="${page === key ? 'active' : ''}" data-page="${key}" ${page === key ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span> ${label}</button>`
    ).join('');
  }
}
function render() {
  nav();
  const meta = {
    dashboard: ['Visão geral', 'Seu negócio em um só lugar.'],
    appointments: ['Agendamentos', 'Organize seus próximos serviços.'],
    customers: ['Clientes e veículos', 'Histórico de clientes da Godoy Auto Care.'],
    inspections: ['Fichas de lavagem', 'Inspeção e controle de qualidade.'],
    finance: ['Controle financeiro', 'Serviços, recebimentos e despesas separados.'],
    settings: ['Dados e segurança', 'Cópias de segurança e informações da versão.']
  };
  document.getElementById('pageTitle').textContent = meta[page][0];
  document.getElementById('pageSub').textContent = meta[page][1];
  document.getElementById('view').innerHTML = ({ dashboard, appointments, customers, inspections, finance, settings })[page]();
  renderStorageNotice();
}

function dashboard() {
  const totals = D.totals(db);
  const next = db.appointments.filter(a => a.status === 'Agendado').sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  return `<div class="cards">${card('Pagamentos recebidos', money(totals.received))}${card('Serviços concluídos', completed().length)}${card('Clientes cadastrados', db.customers.length)}${card('Agendamentos pendentes', next.length)}</div>
    <section class="panel"><div class="row"><h2>Próximos atendimentos</h2><button class="btn" data-page="appointments">+ Agendar</button></div>
    ${next.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Valor</th></tr></thead><tbody>${next.slice(0, 8).map(a => `<tr><td>${dateBR(a.date)} ${esc(a.time)}</td><td>${esc(customerName(a.customerId))}</td><td>${esc(a.service)}</td><td>${money(a.price)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhum agendamento pendente.')}</section>
    <div class="notice">Recebimentos dependem dos pagamentos registrados no Financeiro. Concluir um atendimento mantém seu valor a receber até o pagamento ser lançado.</div>`;
}
function customers() {
  return `<section class="panel"><h2>Novo cliente</h2><form id="customerForm" class="form">
    ${input('name', 'Nome *', 'required maxlength="100" placeholder="Nome do cliente" autocomplete="name"')}
    ${input('phone', 'Telefone (opcional)', 'type="tel" maxlength="30" placeholder="(65) 99999-9999" autocomplete="tel"')}
    ${input('vehicle', 'Veículo *', 'required maxlength="100" placeholder="Ex.: Toyota Etios Platinum"')}
    ${input('plate', 'Placa (opcional)', 'maxlength="10" placeholder="ABC1D23"')}
    ${formAction('Cadastrar cliente')}</form></section>
    <section class="panel"><h2>Clientes cadastrados (${db.customers.length})</h2>
    ${db.customers.length ? `<div class="tablewrap"><table><thead><tr><th>Cliente</th><th>Veículo</th><th>Telefone</th><th>Ações</th></tr></thead><tbody>${db.customers.map(c => `<tr><td>${esc(c.name)}</td><td>${esc(c.vehicle)} ${c.plate ? '· ' + esc(c.plate) : ''}</td><td>${esc(c.phone || '—')}</td><td>${removeButton('removeCustomer', c.id)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhum cliente cadastrado.')}</section>`;
}
function appointments() {
  return `<section class="panel"><h2>Novo agendamento</h2>${db.customers.length ? `<form id="appointmentForm" class="form">
    ${field('customerId', 'Cliente *', `<select name="customerId" required>${customerOptions()}</select>`)}
    ${field('service', 'Serviço *', `<select name="service">${options(['Lavagem externa', 'Externa + interna básica'])}</select>`)}
    ${input('date', 'Data *', `type="date" required value="${today()}"`)}
    ${input('time', 'Horário *', 'type="time" required value="09:00"')}
    ${input('price', 'Valor combinado (R$) *', 'type="number" min="0" max="9999999.99" step="0.01" required value="40"')}
    ${input('notes', 'Observações', 'maxlength="250" placeholder="Opcional"')}
    ${formAction('Salvar agendamento')}</form>` : empty('Cadastre um cliente antes de criar um agendamento.')}</section>
    <section class="panel"><h2>Agenda (${db.appointments.length})</h2>
    ${db.appointments.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Serviço</th><th>Valor</th><th>Status</th><th>Ações</th></tr></thead><tbody>${[...db.appointments].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).map(a => `<tr><td>${dateBR(a.date)} ${esc(a.time)}</td><td>${esc(customerName(a.customerId))}</td><td>${esc(a.service)}</td><td>${money(a.price)}</td><td><span class="tag ${a.status === 'Concluído' ? 'ok' : a.status === 'Cancelado' ? 'cancel' : ''}">${esc(a.status)}</span></td><td><div class="actions">${a.status === 'Agendado' ? `<button class="btn small" data-action="complete" data-id="${esc(a.id)}" data-mutates>Concluir</button><button class="btn small secondary" data-action="cancel" data-id="${esc(a.id)}" data-mutates>Cancelar</button>` : ''}${removeButton('removeAppointment', a.id)}</div></td></tr>`).join('')}</tbody></table></div>` : empty('Nenhum agendamento registrado.')}</section>`;
}
function inspections() {
  return `<section class="panel"><h2>Nova ficha de inspeção</h2>${db.customers.length ? `<form id="inspectionForm" class="form">
    ${field('customerId', 'Cliente *', `<select name="customerId" required>${customerOptions()}</select>`)}
    ${input('date', 'Data *', `type="date" required value="${today()}"`)}
    ${field('dirt', 'Nível de sujeira', `<select name="dirt"><option>Leve</option><option selected>Normal</option><option>Intensa</option></select>`)}
    ${input('shampoo', 'V-Floc usado (mL)', 'type="number" min="0" max="100000" step="0.1" placeholder="Ex.: 20"')}
    ${input('start', 'Início', 'type="time"')}${input('end', 'Fim', 'type="time"')}
    <fieldset class="field full"><legend>Checklist</legend><div class="checks">${steps.map((step, i) => `<label class="check"><input type="checkbox" name="step${i}"><span>${esc(step)}</span></label>`).join('')}</div></fieldset>
    ${field('notes', 'Observações (inclua danos preexistentes)', '<textarea name="notes" maxlength="1500" placeholder="Condições do veículo e detalhes da lavagem"></textarea>', true)}
    ${formAction('Salvar ficha')}</form>` : empty('Cadastre um cliente antes de criar uma ficha.')}</section>
    <section class="panel"><h2>Fichas salvas (${db.inspections.length})</h2>
    ${db.inspections.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>Etapas</th><th>Produto</th><th>Ações</th></tr></thead><tbody>${[...db.inspections].reverse().map(i => `<tr><td>${dateBR(i.date)}</td><td>${esc(customerName(i.customerId))}</td><td>${i.steps.length}/${steps.length}</td><td>${i.shampoo !== '' ? esc(i.shampoo) + ' mL' : '—'}</td><td><div class="actions"><button class="btn small secondary" data-action="viewInspection" data-id="${esc(i.id)}">Ver</button>${removeButton('removeInspection', i.id)}</div></td></tr>`).join('')}</tbody></table></div>` : empty('Nenhuma ficha registrada.')}</section>`;
}
function finance() {
  const totals = D.totals(db);
  const unpaid = completed().filter(a => remaining(a) > 0);
  return `<div class="cards">${card('Serviços concluídos (valor)', money(totals.estimated))}${card('Pagamentos recebidos', money(totals.received))}${card('A receber', money(totals.receivable))}${card('Despesas registradas', money(totals.expenses))}${card('Saldo de caixa parcial', money(totals.balance))}${card('Ticket médio de serviços', money(totals.average))}</div>
    <section class="panel"><h2>Registrar pagamento</h2>${unpaid.length ? `<form id="paymentForm" class="form">
    ${field('appointmentId', 'Atendimento concluído *', `<select name="appointmentId" required>${unpaid.map(a => `<option value="${esc(a.id)}">${esc(customerName(a.customerId))} — ${dateBR(a.date)} ${esc(a.time)} — restante ${money(remaining(a))}</option>`).join('')}</select>`)}
    ${input('paymentAmount', 'Valor recebido (R$) *', `type="number" min="0.01" max="${remaining(unpaid[0]).toFixed(2)}" step="0.01" required value="${remaining(unpaid[0]).toFixed(2)}"`)}
    ${input('paymentDate', 'Data do pagamento *', `type="date" required value="${today()}"`)}
    ${field('method', 'Forma de pagamento *', `<select name="method">${options(['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'])}</select>`)}
    ${formAction('Registrar pagamento')}</form>` : empty('Nenhum valor a receber. Conclua um atendimento na Agenda para registrar seu pagamento.')}</section>
    <section class="panel"><h2>Pagamentos (${db.payments.length})</h2>${db.payments.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Cliente / atendimento</th><th>Forma</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${[...db.payments].reverse().map(p => { const a = db.appointments.find(item => item.id === p.appointmentId); return `<tr><td>${dateBR(p.date)}</td><td>${esc(customerName(a.customerId))} · ${dateBR(a.date)} ${esc(a.time)}</td><td>${esc(p.method)}</td><td>${money(p.amount)}</td><td>${removeButton('removePayment', p.id)}</td></tr>`; }).join('')}</tbody></table></div>` : empty('Nenhum pagamento registrado.')}</section>
    <section class="panel"><h2>Registrar despesa</h2><form id="expenseForm" class="form">
    ${input('description', 'Descrição *', 'maxlength="120" required placeholder="Ex.: Panos de microfibra"')}
    ${input('amount', 'Valor (R$) *', 'type="number" min="0.01" max="9999999.99" step="0.01" required')}
    ${input('date', 'Data *', `type="date" required value="${today()}"`)}
    ${field('category', 'Categoria', `<select name="category">${options(['Produtos', 'Equipamentos', 'Água e energia', 'Mão de obra', 'Outros'])}</select>`)}
    ${formAction('Registrar despesa')}</form></section>
    <section class="panel"><h2>Despesas (${db.expenses.length})</h2>${db.expenses.length ? `<div class="tablewrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Ações</th></tr></thead><tbody>${[...db.expenses].reverse().map(e => `<tr><td>${dateBR(e.date)}</td><td>${esc(e.description)}</td><td>${esc(e.category)}</td><td>${money(e.amount)}</td><td>${removeButton('removeExpense', e.id)}</td></tr>`).join('')}</tbody></table></div>` : empty('Nenhuma despesa registrada.')}</section>
    <div class="notice">Os totais acumulam todos os registros. Serviços concluídos geram valores a receber; pagamentos são lançados manualmente e podem ser parciais. O saldo de caixa é recebimentos menos despesas registradas e não representa lucro líquido.</div>`;
}
function settings() {
  return `<section class="panel"><h2>Backup dos seus registros</h2><p>Baixe um arquivo JSON e guarde uma cópia em local seguro. Importar substitui todos os registros deste navegador, após validação e confirmação.</p>
    <div class="actions backup-actions"><button class="btn" data-action="export" ${blocked ? 'disabled' : ''}>Baixar backup (.json)</button><label class="btn secondary file-picker" for="importFile">Importar backup<input id="importFile" type="file" accept=".json,application/json" aria-label="Importar backup"></label></div>
    <p class="backup-help">Backups V1 e V2 são aceitos, até 10 MB. A V1 não contém pagamentos: revise os valores a receber depois de importar.</p></section>
    ${blocked ? `<section class="panel"><h2>Recuperar dados locais</h2><p>Os dados originais não foram sobrescritos. Salve uma cópia do conteúdo para análise antes de importar um backup válido ou reiniciar.</p><div class="actions backup-actions"><button class="btn secondary" data-action="exportRaw">Baixar conteúdo original</button><button class="btn secondary" data-action="reload">Tentar ler novamente</button></div></section>` : ''}
    ${conflict ? '<section class="panel"><h2>Dados alterados em outra aba</h2><button class="btn" data-action="reload">Recarregar dados</button></section>' : ''}
    <section class="panel"><h2>Segurança e limitações</h2><p>Versão 1.1 local, sem login, servidor ou sincronização. Os dados ficam neste navegador e dispositivo. Limpar os dados do navegador ou usar navegação privada pode apagá-los. Use dados fictícios até implementar autenticação, banco seguro e política de backup. Ainda não é um PWA instalável.</p></section>
    <section class="panel"><h2>Reiniciar protótipo</h2><p>Apaga todos os registros deste navegador. Exporte um backup antes.</p><div class="backup-actions"><button class="btn danger" data-action="reset" ${conflict ? 'disabled' : ''}>Apagar todos os dados</button></div></section>`;
}

function download(content, filename) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showInspection(ref) {
  const item = db.inspections.find(i => i.id === ref);
  if (!item) return;
  const dialog = document.getElementById('inspectionDialog');
  dialog.querySelector('pre').textContent = `Cliente: ${customerName(item.customerId)}\nData: ${dateBR(item.date)}\nSujeira: ${item.dirt}\nInício: ${item.start || '—'} | Fim: ${item.end || '—'}\nV-Floc: ${item.shampoo === '' ? '—' : item.shampoo} mL\n\n${steps.map((s, n) => `${item.steps.includes(n) ? '✓' : '○'} ${s}`).join('\n')}\n\nObservações: ${item.notes || 'Nenhuma'}`;
  dialog.showModal();
}

document.addEventListener('click', event => {
  const navigation = event.target.closest('[data-page]');
  if (navigation) { setPage(navigation.dataset.page); return; }
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  const ref = button.dataset.id;
  if (action === 'reload') { window.location.reload(); return; }
  if (action === 'export' || action === 'exportRaw') {
    try {
      const content = action === 'exportRaw' ? storage.getItem(D.KEY) : JSON.stringify(D.makeBackup(db));
      if (content == null) throw Error('Não há conteúdo local disponível para exportar.');
      download(content, `godoy-manager-${action === 'exportRaw' ? 'recuperacao' : 'backup'}-${today()}.json`);
      feedback('Download solicitado. Guarde o arquivo em local seguro.');
    } catch (error) { feedback(`Falha ao exportar: ${error.message}`, true); }
    return;
  }
  if (action === 'reset') {
    if (!confirm('Apagar TODOS os dados locais? Exporte uma cópia antes. Essa ação não pode ser desfeita.')) return;
    try { persist(D.fresh(), true); render(); feedback('Dados locais apagados.'); }
    catch (error) { feedback(`Não foi possível apagar: ${error.message}`, true); }
    return;
  }
  if (action === 'viewInspection') { showInspection(ref); return; }
  if (action === 'complete' || action === 'cancel') {
    const appointment = db.appointments.find(a => a.id === ref);
    if (!appointment || appointment.status !== 'Agendado') return;
    if (!confirm(action === 'complete' ? 'Marcar atendimento como concluído? O pagamento deve ser registrado no Financeiro.' : 'Cancelar agendamento?')) return;
    transaction(next => { next.appointments.find(a => a.id === ref).status = action === 'complete' ? 'Concluído' : 'Cancelado'; }, 'Status do atendimento salvo.');
    return;
  }
  const removals = {
    removeCustomer: ['customers', 'cliente'], removeAppointment: ['appointments', 'agendamento'],
    removeInspection: ['inspections', 'ficha'], removeExpense: ['expenses', 'despesa'], removePayment: ['payments', 'pagamento']
  };
  if (!removals[action]) return;
  const [collection, label] = removals[action];
  if (collection === 'customers' && (db.appointments.some(a => a.customerId === ref) || db.inspections.some(i => i.customerId === ref))) {
    feedback('Este cliente tem atendimentos ou fichas vinculados. Remova os vínculos antes de excluir.', true); return;
  }
  if (collection === 'appointments' && db.payments.some(p => p.appointmentId === ref)) {
    feedback('Este atendimento tem pagamentos vinculados. Remova os pagamentos antes de excluir.', true); return;
  }
  if (!confirm(`Excluir ${label}?${collection === 'payments' ? ' O valor voltará a ficar a receber.' : ''}`)) return;
  transaction(next => { next[collection] = next[collection].filter(item => item.id !== ref); }, `${label[0].toUpperCase() + label.slice(1)} excluído.`);
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (!['customerForm', 'appointmentForm', 'inspectionForm', 'expenseForm', 'paymentForm'].includes(form.id)) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  transaction(next => {
    switch (form.id) {
      case 'customerForm':
        next.customers.push({ id: id(), name: val(form, 'name'), phone: val(form, 'phone'), vehicle: val(form, 'vehicle'), plate: val(form, 'plate').toUpperCase() });
        break;
      case 'appointmentForm':
        next.appointments.push({ id: id(), customerId: val(form, 'customerId'), service: val(form, 'service'), date: val(form, 'date'), time: val(form, 'time'), price: Number(val(form, 'price')), notes: val(form, 'notes'), status: 'Agendado' });
        break;
      case 'inspectionForm':
        next.inspections.push({ id: id(), customerId: val(form, 'customerId'), date: val(form, 'date'), dirt: val(form, 'dirt'), shampoo: val(form, 'shampoo'), start: val(form, 'start'), end: val(form, 'end'), notes: val(form, 'notes'), steps: steps.map((_, i) => i).filter(i => form.elements[`step${i}`].checked) });
        break;
      case 'expenseForm':
        next.expenses.push({ id: id(), description: val(form, 'description'), amount: Number(val(form, 'amount')), date: val(form, 'date'), category: val(form, 'category') });
        break;
      case 'paymentForm':
        next.payments.push({ id: id(), appointmentId: val(form, 'appointmentId'), amount: Number(val(form, 'paymentAmount')), date: val(form, 'paymentDate'), method: val(form, 'method') });
        break;
    }
  }, 'Registro salvo neste navegador.');
});

document.addEventListener('change', async event => {
  if (event.target.form?.id === 'paymentForm' && event.target.name === 'appointmentId') {
    const appointment = db.appointments.find(a => a.id === event.target.value);
    const amount = event.target.form.elements.paymentAmount;
    amount.max = remaining(appointment).toFixed(2);
    amount.value = amount.max;
  }
  if (event.target.id !== 'importFile') return;
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > D.MAX_BACKUP_BYTES) throw Error('Arquivo muito grande. O limite é 10 MB.');
    const incoming = D.parseBackup(await file.text());
    if (!confirm('Substituir TODOS os registros atuais pelos dados do backup? Baixe uma cópia dos dados atuais antes de continuar.')) return;
    persist(incoming, true);
    render();
    feedback('Backup importado e salvo neste navegador.');
  } catch (error) { feedback(`Falha ao importar: ${error.message}`, true); }
  finally { event.target.value = ''; }
});
window.addEventListener('storage', event => {
  if (event.key === D.KEY || event.key === null) {
    conflict = true;
    renderStorageNotice();
  }
});
render();
