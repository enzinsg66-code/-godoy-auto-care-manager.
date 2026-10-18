(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GodoyData = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'godoy_manager_v1';
  const MAX_BACKUP_BYTES = 10000000;
  const STEPS = Object.freeze([
    'Inspeção inicial e danos preexistentes', 'Pré-enxágue', 'Rodas e pneus',
    'Lavagem da carroceria', 'Enxágue', 'Secagem',
    'Limpeza interna básica (se contratada)', 'Inspeção final'
  ]);
  const SERVICES = ['Lavagem externa', 'Externa + interna básica'];
  const CATEGORIES = ['Produtos', 'Equipamentos', 'Água e energia', 'Mão de obra', 'Outros'];
  const METHODS = ['Pix', 'Dinheiro', 'Cartão', 'Transferência', 'Outro'];
  const LIMIT = 10000;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

  function fail(message) { throw new Error(message); }

  function record(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
      fail(label + ': deve ser um objeto.');
    }
    return value;
  }

  function field(object, key) { return own(object, key) ? object[key] : undefined; }

  function text(value, label, max, optional) {
    if (value === undefined && optional) return '';
    if (typeof value !== 'string') fail(label + ': deve ser um texto.');
    if (value.length > max) fail(label + ': limite de ' + max + ' caracteres.');
    const normalized = value.trim();
    if (!optional && !normalized) fail(label + ': preenchimento obrigatório.');
    return normalized;
  }

  function id(value, label) { return text(value, label, 200, false); }

  function choice(value, values, label) {
    if (!values.includes(value)) fail(label + ': opção inválida.');
    return value;
  }

  function date(value, label) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      fail(label + ': use uma data válida no formato AAAA-MM-DD.');
    }
    const [year, month, day] = value.split('-').map(Number);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
      fail(label + ': data inexistente.');
    }
    return value;
  }

  function time(value, label, optional) {
    if (value === undefined && optional) return '';
    if (optional && value === '') return '';
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      fail(label + ': use um horário válido no formato HH:MM.');
    }
    return value;
  }

  // All financial aggregation uses integer cents. The tolerance only admits
  // the binary representation error of numbers such as 0.1 + 0.2.
  function cents(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      fail('Valor monetário: informe um número finito.');
    }
    const parts = Math.abs(value).toString().split('e');
    const shifted = Number(parts[0] + 'e' + (Number(parts[1] || 0) + 2));
    const rounded = Math.round(shifted);
    if (!Number.isSafeInteger(rounded)) fail('Valor monetário acima do limite seguro.');
    return value < 0 ? -rounded : rounded;
  }

  function amount(value, label, positive) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 ||
        (positive && value <= 0)) {
      fail(label + ': informe um valor ' + (positive ? 'maior que zero' : 'não negativo') + ' e finito.');
    }
    const integer = cents(value);
    const raw = value * 100;
    if (Math.abs(raw - integer) > Number.EPSILON * Math.max(1, Math.abs(raw)) * 4) {
      fail(label + ': use no máximo duas casas decimais.');
    }
    if (positive && integer === 0) fail(label + ': informe ao menos R$ 0,01.');
    return integer / 100;
  }

  function add(left, right, label) {
    const sum = left + right;
    if (!Number.isSafeInteger(sum)) fail(label + ': total acima do limite monetário seguro.');
    return sum;
  }

  function collection(value, label, optional) {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) fail(label + ': deve ser uma lista.');
    if (value.length > LIMIT) fail(label + ': limite de ' + LIMIT + ' registros.');
    return value;
  }

  function mapRecords(value, label, normalize) {
    const seen = new Set();
    return value.map((item, index) => {
      const path = label + '[' + (index + 1) + ']';
      record(item, path);
      const normalized = normalize(item, path);
      if (seen.has(normalized.id)) fail(path + ': identificador duplicado.');
      seen.add(normalized.id);
      return normalized;
    });
  }

  function fresh() {
    return { schemaVersion: 2, customers: [], appointments: [], inspections: [], expenses: [], payments: [] };
  }

  function validateData(input) {
    record(input, 'Dados');
    const version = field(input, 'schemaVersion');
    if (version !== undefined && version !== 1 && version !== 2) fail('Versão dos dados não suportada.');
    const result = fresh();
    result.customers = mapRecords(collection(field(input, 'customers'), 'Clientes'), 'Clientes', (item, path) => ({
      id: id(field(item, 'id'), path + '.id'),
      name: text(field(item, 'name'), path + '.nome', 100, false),
      phone: text(field(item, 'phone'), path + '.telefone', 30, true),
      vehicle: text(field(item, 'vehicle'), path + '.veículo', 100, false),
      plate: text(field(item, 'plate'), path + '.placa', 10, true)
    }));
    const customerIds = new Set(result.customers.map(item => item.id));
    function customer(value, label) {
      const normalized = id(value, label);
      if (!customerIds.has(normalized)) fail(label + ': cliente vinculado não existe.');
      return normalized;
    }
    result.appointments = mapRecords(collection(field(input, 'appointments'), 'Agendamentos'), 'Agendamentos', (item, path) => ({
      id: id(field(item, 'id'), path + '.id'),
      customerId: customer(field(item, 'customerId'), path + '.cliente'),
      service: choice(field(item, 'service'), SERVICES, path + '.serviço'),
      date: date(field(item, 'date'), path + '.data'),
      time: time(field(item, 'time'), path + '.horário', false),
      price: amount(field(item, 'price'), path + '.preço', false),
      notes: text(field(item, 'notes'), path + '.observações', 250, true),
      status: choice(field(item, 'status'), ['Agendado', 'Concluído', 'Cancelado'], path + '.status')
    }));
    result.inspections = mapRecords(collection(field(input, 'inspections'), 'Fichas'), 'Fichas', (item, path) => {
      const shampoo = text(field(item, 'shampoo'), path + '.produto', 40, true);
      if (shampoo && (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(shampoo) ||
          !Number.isFinite(Number(shampoo)) || Number(shampoo) < 0)) {
        fail(path + '.produto: informe uma quantidade não negativa e finita.');
      }
      const steps = collection(field(item, 'steps'), path + '.checklist', true);
      if (steps.length > STEPS.length || steps.some(step => !Number.isInteger(step) || step < 0 || step >= STEPS.length) ||
          new Set(steps).size !== steps.length) fail(path + '.checklist: etapas inválidas ou repetidas.');
      return {
        id: id(field(item, 'id'), path + '.id'),
        customerId: customer(field(item, 'customerId'), path + '.cliente'),
        date: date(field(item, 'date'), path + '.data'),
        dirt: choice(field(item, 'dirt'), ['Leve', 'Normal', 'Intensa'], path + '.sujeira'),
        shampoo,
        start: time(field(item, 'start'), path + '.início', true),
        end: time(field(item, 'end'), path + '.fim', true),
        notes: text(field(item, 'notes'), path + '.observações', 1500, true),
        steps: steps.slice()
      };
    });
    result.expenses = mapRecords(collection(field(input, 'expenses'), 'Despesas'), 'Despesas', (item, path) => ({
      id: id(field(item, 'id'), path + '.id'),
      description: text(field(item, 'description'), path + '.descrição', 120, false),
      amount: amount(field(item, 'amount'), path + '.valor', true),
      date: date(field(item, 'date'), path + '.data'),
      category: choice(field(item, 'category'), CATEGORIES, path + '.categoria')
    }));
    const appointments = new Map(result.appointments.map(item => [item.id, item]));
    const paid = new Map();
    result.payments = mapRecords(collection(field(input, 'payments'), 'Pagamentos', version !== 2), 'Pagamentos', (item, path) => {
      const normalized = {
        id: id(field(item, 'id'), path + '.id'),
        appointmentId: id(field(item, 'appointmentId'), path + '.agendamento'),
        amount: amount(field(item, 'amount'), path + '.valor', true),
        date: date(field(item, 'date'), path + '.data'),
        method: choice(field(item, 'method'), METHODS, path + '.forma')
      };
      const appointment = appointments.get(normalized.appointmentId);
      if (!appointment) fail(path + ': agendamento vinculado não existe.');
      if (appointment.status !== 'Concluído') fail(path + ': pagamentos exigem um atendimento concluído.');
      const total = add(paid.get(appointment.id) || 0, cents(normalized.amount), path);
      if (total > cents(appointment.price)) fail(path + ': pagamentos excedem o valor combinado do atendimento.');
      paid.set(appointment.id, total);
      return normalized;
    });
    // A validated database must also be safe to aggregate without overflow.
    totals(result);
    return result;
  }

  function totals(db) {
    let estimated = 0, received = 0, expenses = 0, completed = 0;
    db.appointments.forEach(item => {
      if (item.status === 'Concluído') {
        estimated = add(estimated, cents(item.price), 'Faturamento');
        completed += 1;
      }
    });
    db.payments.forEach(item => { received = add(received, cents(item.amount), 'Recebimentos'); });
    db.expenses.forEach(item => { expenses = add(expenses, cents(item.amount), 'Despesas'); });
    return {
      estimated: estimated / 100,
      received: received / 100,
      expenses: expenses / 100,
      receivable: (estimated - received) / 100,
      balance: (received - expenses) / 100,
      average: completed ? estimated / completed / 100 : 0
    };
  }

  function parseBackup(source) {
    if (typeof source !== 'string') fail('Backup: o conteúdo deve ser um texto JSON.');
    checkBackupSize(source);
    let envelope;
    try { envelope = JSON.parse(source); }
    catch (error) { fail('Backup: JSON inválido.'); }
    record(envelope, 'Backup');
    if (field(envelope, 'app') !== 'godoy-manager') fail('Backup: aplicativo de origem inválido.');
    const version = field(envelope, 'version');
    if (![1, 2].includes(version)) fail('Backup: versão não suportada.');
    const data = record(field(envelope, 'data'), 'Dados do backup');
    const schemaVersion = field(data, 'schemaVersion');
    if ((version === 2 && schemaVersion !== 2) ||
        (schemaVersion !== undefined && schemaVersion !== version)) {
      fail('Backup: a versão do arquivo não corresponde à versão dos dados.');
    }
    return validateData(data);
  }

  function makeBackup(db) {
    const envelope = { app: 'godoy-manager', version: 2, exportedAt: new Date().toISOString(), data: validateData(db) };
    checkBackupSize(JSON.stringify(envelope));
    return envelope;
  }

  // Count UTF-8 bytes without depending on TextEncoder (also works in file://
  // browsers and lightweight Node VM contexts). Lone surrogates occupy the
  // replacement character's three bytes, matching Blob/TextEncoder semantics.
  function checkBackupSize(source) {
    let bytes = 0;
    for (let index = 0; index < source.length; index++) {
      const code = source.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < source.length &&
          source.charCodeAt(index + 1) >= 0xdc00 && source.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
      if (bytes > MAX_BACKUP_BYTES) fail('Backup: limite de 10 MB excedido.');
    }
  }

  function read(storage) {
    try {
      if (!storage || typeof storage.getItem !== 'function') fail('Armazenamento local indisponível.');
      const source = storage.getItem(KEY);
      if (source === null) return { data: fresh(), error: null, blocked: false };
      return { data: validateData(JSON.parse(source)), error: null, blocked: false };
    } catch (error) {
      return {
        data: fresh(),
        error: 'Não foi possível carregar os dados locais. A gravação foi bloqueada para preservar os registros. ' +
          (error instanceof Error ? error.message : 'Armazenamento indisponível.'),
        blocked: true
      };
    }
  }

  function write(storage, next) {
    const normalized = validateData(next);
    makeBackup(normalized);
    try { storage.setItem(KEY, JSON.stringify(normalized)); }
    catch (error) {
      fail('Não foi possível salvar os dados neste navegador. Os registros atuais foram preservados.');
    }
    return normalized;
  }

  return Object.freeze({ KEY, MAX_BACKUP_BYTES, STEPS, fresh, validateData, parseBackup, makeBackup, read, write, cents, totals });
}));
