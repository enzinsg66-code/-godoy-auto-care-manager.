'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../domain.js');

function legacy() {
  return {
    customers: [{ id: 'customer-1', name: 'Ana', phone: '(65) 99999-0000', vehicle: 'Etios', plate: 'ABC1D23' }],
    appointments: [{ id: 'appointment-1', customerId: 'customer-1', service: 'Lavagem externa', date: '2026-10-18', time: '09:00', price: 40, notes: '', status: 'Concluído' }],
    inspections: [{ id: 'inspection-1', customerId: 'customer-1', date: '2026-10-18', dirt: 'Normal', shampoo: '20', start: '09:00', end: '10:00', notes: '', steps: [0, 1, 7] }],
    expenses: [{ id: 'expense-1', description: 'Produto', amount: 12.50, date: '2026-10-18', category: 'Produtos' }]
  };
}

function payment(overrides = {}) {
  return { id: 'payment-1', appointmentId: 'appointment-1', amount: 10, date: '2026-10-18', method: 'Pix', ...overrides };
}

function store(initial = null) {
  let value = initial;
  let writes = 0;
  return {
    getItem(key) { assert.equal(key, D.KEY); return value; },
    setItem(key, next) { assert.equal(key, D.KEY); value = next; writes++; },
    get value() { return value; },
    get writes() { return writes; }
  };
}

test('legacy backup migrates without inventing received payments or mutating its source', () => {
  const original = legacy();
  const serialized = JSON.stringify(original);
  const actual = D.parseBackup(JSON.stringify({ app: 'godoy-manager', version: 1, data: original }));
  assert.equal(actual.schemaVersion, 2);
  assert.deepEqual(actual.payments, []);
  assert.equal(JSON.stringify(original), serialized);
  assert.notEqual(actual.customers[0], original.customers[0]);
  assert.notEqual(actual.inspections[0].steps, original.inspections[0].steps);
  assert.deepEqual(D.totals(actual), { estimated: 40, received: 0, expenses: 12.5, receivable: 40, balance: -12.5, average: 40 });
});

test('missing optional fields are normalized and backup v2 round trips', () => {
  const source = legacy();
  for (const key of ['phone', 'plate']) delete source.customers[0][key];
  delete source.appointments[0].notes;
  for (const key of ['shampoo', 'start', 'end', 'notes', 'steps']) delete source.inspections[0][key];
  const normalized = D.validateData(source);
  assert.equal(normalized.customers[0].phone, '');
  assert.equal(normalized.customers[0].plate, '');
  assert.equal(normalized.appointments[0].notes, '');
  assert.equal(normalized.inspections[0].shampoo, '');
  assert.equal(normalized.inspections[0].start, '');
  assert.equal(normalized.inspections[0].end, '');
  assert.deepEqual(normalized.inspections[0].steps, []);
  const backup = D.makeBackup(normalized);
  assert.equal(backup.version, 2);
  assert.match(backup.exportedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(D.parseBackup(JSON.stringify(backup)), normalized);
});

test('schema v2 requires an explicit payment collection to avoid silent financial data loss', () => {
  const incomplete = legacy();
  incomplete.schemaVersion = 2;
  assert.throws(() => D.validateData(incomplete), /Pagamentos.*lista/);
  incomplete.payments = null;
  assert.throws(() => D.validateData(incomplete), /Pagamentos.*lista/);
  incomplete.payments = [];
  assert.deepEqual(D.validateData(incomplete).payments, []);
  const v1 = legacy();
  v1.schemaVersion = 1;
  assert.deepEqual(D.validateData(v1).payments, []);
  const storage = store(JSON.stringify({ ...legacy(), schemaVersion: 2 }));
  assert.equal(D.read(storage).blocked, true);
  assert.equal(storage.writes, 0);
});

test('untrusted HTML remains plain text and unknown/prototype properties do not enter normalized records', () => {
  const source = legacy();
  const maliciousId = '\"><img src=x onerror="alert(1)">';
  source.customers[0].id = maliciousId;
  source.customers[0].name = '<script>alert(1)</script>';
  source.appointments[0].customerId = maliciousId;
  source.inspections[0].customerId = maliciousId;
  source.customers[0].onclick = 'alert(1)';
  source.extra = { constructor: { prototype: { polluted: true } } };
  const raw = JSON.parse(JSON.stringify(source));
  Object.defineProperty(raw.customers[0], '__proto__', { value: { polluted: true }, enumerable: true });
  const result = D.validateData(raw);
  assert.equal(result.customers[0].id, maliciousId);
  assert.equal(result.customers[0].name, '<script>alert(1)</script>');
  assert.equal(Object.hasOwn(result.customers[0], '__proto__'), false);
  assert.equal(Object.hasOwn(result.customers[0], 'onclick'), false);
  assert.equal(Object.hasOwn(result, 'extra'), false);
  assert.equal({}.polluted, undefined);
});

test('record types, required collections, versions and text limits are enforced', () => {
  for (const bad of [null, [], 1, 'data', new Date()]) assert.throws(() => D.validateData(bad));
  assert.throws(() => D.validateData({}), /Clientes/);
  const cases = [
    db => { db.schemaVersion = 3; },
    db => { db.customers = {}; },
    db => { db.customers[0] = null; },
    db => { db.customers[0].name = 42; },
    db => { db.customers[0].name = ' '; },
    db => { db.customers[0].name = 'a'.repeat(101); },
    db => { db.customers[0].phone = 'a'.repeat(31); },
    db => { db.customers[0].vehicle = 'a'.repeat(101); },
    db => { db.customers[0].plate = 'a'.repeat(11); },
    db => { db.customers[0].id = 'x'.repeat(201); },
    db => { db.appointments[0].notes = 'a'.repeat(251); },
    db => { db.inspections[0].notes = 'a'.repeat(1501); },
    db => { db.expenses[0].description = 'a'.repeat(121); }
  ];
  for (const corrupt of cases) { const db = legacy(); corrupt(db); assert.throws(() => D.validateData(db), Error); }
  const tooMany = legacy();
  tooMany.customers = Array.from({ length: 10001 }, (_, index) => ({ ...tooMany.customers[0], id: 'c' + index }));
  assert.throws(() => D.validateData(tooMany), /10000/);
});

test('every collection rejects duplicate IDs and all relationships must exist', () => {
  for (const key of ['customers', 'appointments', 'inspections', 'expenses', 'payments']) {
    const db = legacy();
    if (key === 'payments') db.payments = [payment()];
    db[key].push({ ...db[key][0] });
    assert.throws(() => D.validateData(db), /duplicado/);
  }
  for (const key of ['appointments', 'inspections']) {
    const db = legacy(); db[key][0].customerId = 'missing';
    assert.throws(() => D.validateData(db), /cliente vinculado/);
  }
  const db = legacy(); db.payments = [payment({ appointmentId: 'missing' })];
  assert.throws(() => D.validateData(db), /agendamento vinculado/);
});

test('dates, times, enums, numerical shampoo and checklist are fully validated', () => {
  const invalid = [
    db => { db.appointments[0].date = '2026-02-29'; },
    db => { db.appointments[0].date = '2026-04-31'; },
    db => { db.appointments[0].date = '0000-01-01'; },
    db => { db.appointments[0].date = '2026-1-01'; },
    db => { db.appointments[0].time = '24:00'; },
    db => { db.inspections[0].end = '10:60'; },
    db => { db.inspections[0].start = null; },
    db => { db.appointments[0].status = 'Recebido'; },
    db => { db.appointments[0].service = 'Outro'; },
    db => { db.expenses[0].category = 'Desconhecida'; },
    db => { db.inspections[0].dirt = 'Média'; },
    db => { db.inspections[0].shampoo = 20; },
    db => { db.inspections[0].shampoo = 'Infinity'; },
    db => { db.inspections[0].shampoo = '-1'; },
    db => { db.inspections[0].shampoo = '0x10'; },
    db => { db.inspections[0].steps = [0, 8]; },
    db => { db.inspections[0].steps = ['1']; },
    db => { db.inspections[0].steps = [1, 1]; },
    db => { db.inspections[0].steps = [0.5]; }
  ];
  for (const corrupt of invalid) { const db = legacy(); corrupt(db); assert.throws(() => D.validateData(db), Error); }
  const valid = legacy();
  valid.appointments[0].date = '2024-02-29';
  valid.inspections[0].shampoo = '2e1';
  assert.equal(D.validateData(valid).inspections[0].shampoo, '2e1');
});

test('invalid money is rejected and decimal cents do not accumulate floating point errors', () => {
  for (const value of [-1, NaN, Infinity, '40', 0.001, Number.MAX_VALUE]) {
    const db = legacy(); db.appointments[0].price = value;
    assert.throws(() => D.validateData(db), Error);
  }
  for (const value of [0, -1, NaN, Infinity, '1', 0.001]) {
    const db = legacy(); db.expenses[0].amount = value;
    assert.throws(() => D.validateData(db), Error);
  }
  assert.equal(D.cents(0.1 + 0.2), 30);
  assert.equal(D.cents(1.005), 101);
  assert.equal(D.cents(-1.005), -101);
  assert.equal(D.cents(12345678901234.56), 1234567890123456);
  const db = legacy(); db.appointments[0].price = 0.1 + 0.2;
  assert.equal(D.validateData(db).appointments[0].price, 0.3);
});

test('only completed appointments accept payments, with a strictly positive amount and no overpayment', () => {
  const corruptions = [
    db => { db.appointments[0].status = 'Agendado'; },
    db => { db.appointments[0].status = 'Cancelado'; },
    db => { db.payments[0].amount = 0; },
    db => { db.payments[0].amount = -1; },
    db => { db.payments[0].amount = NaN; },
    db => { db.payments[0].amount = 40.01; },
    db => { db.payments[0].method = 'Cheque'; },
    db => { db.payments[0].date = '2026-02-30'; },
    db => { db.payments.push(payment({ id: 'payment-2', amount: 30.01 })); }
  ];
  for (const corrupt of corruptions) {
    const db = legacy(); db.payments = [payment()]; corrupt(db);
    assert.throws(() => D.validateData(db), Error);
  }
  const db = legacy(); db.payments = [payment(), payment({ id: 'payment-2', amount: 30 })];
  assert.equal(D.validateData(db).payments.length, 2);
});

test('financial totals separate revenue from receipts and never double count a completed appointment', () => {
  const db = legacy();
  db.appointments[0].price = 0.3;
  db.appointments.push({ ...db.appointments[0], id: 'scheduled', price: 999, status: 'Agendado' });
  db.appointments.push({ ...db.appointments[0], id: 'cancelled', price: 999, status: 'Cancelado' });
  db.payments = [payment({ amount: 0.1 }), payment({ id: 'payment-2', amount: 0.2, method: 'Dinheiro' })];
  db.expenses[0].amount = 0.2;
  assert.deepEqual(D.totals(D.validateData(db)), { estimated: 0.3, received: 0.3, expenses: 0.2, receivable: 0, balance: 0.1, average: 0.3 });
  assert.deepEqual(D.totals(D.fresh()), { estimated: 0, received: 0, expenses: 0, receivable: 0, balance: 0, average: 0 });
});

test('missing storage creates a fresh database; corrupted or inaccessible storage blocks writes without replacing data', () => {
  const empty = store();
  assert.deepEqual(D.read(empty), { data: D.fresh(), error: null, blocked: false });
  for (const initial of ['{broken', 'null', '{}', '[]', JSON.stringify({ ...legacy(), customers: [] })]) {
    const storage = store(initial);
    const loaded = D.read(storage);
    assert.equal(loaded.blocked, true);
    assert.match(loaded.error, /gravação foi bloqueada/);
    assert.equal(storage.value, initial);
    assert.equal(storage.writes, 0);
  }
  const denied = D.read({ getItem() { throw new Error('Acesso negado'); } });
  assert.equal(denied.blocked, true);
  assert.match(denied.error, /Acesso negado/);
  for (const unavailable of [undefined, null, {}, { getItem: 1 }]) {
    const result = D.read(unavailable);
    assert.equal(result.blocked, true);
    assert.match(result.error, /Armazenamento local indisponível/);
    assert.doesNotMatch(result.error, /TypeError|Cannot read/);
  }
  const storage = store(JSON.stringify(legacy()));
  assert.equal(D.read(storage).data.schemaVersion, 2);
  assert.equal(storage.writes, 0, 'reading/migrating must never write implicitly');
});

test('writes validate first and return independent normalized data only after storage succeeds', () => {
  const source = legacy();
  const before = JSON.stringify(source);
  const storage = store('old');
  const result = D.write(storage, source);
  assert.equal(storage.writes, 1);
  assert.equal(JSON.stringify(source), before);
  assert.notEqual(result.customers[0], source.customers[0]);
  assert.deepEqual(JSON.parse(storage.value), result);
  source.appointments[0].price = -1;
  assert.throws(() => D.write(storage, source));
  assert.equal(storage.writes, 1);
  const healthy = legacy();
  const healthyBefore = JSON.stringify(healthy);
  assert.throws(() => D.write({ setItem() { throw new Error('QuotaExceededError'); } }, healthy), /Não foi possível salvar/);
  assert.equal(JSON.stringify(healthy), healthyBefore);
});

test('backup envelopes reject invalid JSON, app identifiers, versions and invalid records', () => {
  for (const source of ['not JSON', 'null', '[]', '{}']) assert.throws(() => D.parseBackup(source));
  for (const envelope of [
    { app: 'other', version: 1, data: legacy() },
    { app: 'godoy-manager', version: 3, data: legacy() },
    { app: 'godoy-manager', version: '1', data: legacy() },
    { app: 'godoy-manager', version: 1, data: {} }
  ]) assert.throws(() => D.parseBackup(JSON.stringify(envelope)));
});

test('backup envelope and explicit schema versions must match; legacy backups without a schema remain valid', () => {
  const v1 = legacy();
  const v2 = D.validateData(v1);
  for (const data of [v1, { ...v1, schemaVersion: 1 }]) {
    assert.throws(() => D.parseBackup(JSON.stringify({ app: 'godoy-manager', version: 2, data })), /versão.*corresponde/);
  }
  assert.throws(() => D.parseBackup(JSON.stringify({ app: 'godoy-manager', version: 1, data: v2 })), /versão.*corresponde/);
  assert.equal(D.parseBackup(JSON.stringify({ app: 'godoy-manager', version: 1, data: v1 })).schemaVersion, 2);
  assert.equal(D.parseBackup(JSON.stringify({ app: 'godoy-manager', version: 1, data: { ...v1, schemaVersion: 1 } })).schemaVersion, 2);
  assert.deepEqual(D.parseBackup(JSON.stringify({ app: 'godoy-manager', version: 2, data: v2 })), v2);
});

test('a compact backup above the previous 2 MB limit remains exportable, writable and restorable', () => {
  assert.equal(D.MAX_BACKUP_BYTES, 10000000);
  const db = legacy();
  const example = { ...db.inspections[0], notes: 'a'.repeat(1400) + 'á'.repeat(100) };
  db.inspections = Array.from({ length: 1200 }, (_, index) => ({ ...example, id: 'inspection-' + index, steps: example.steps.slice() }));
  const envelope = D.makeBackup(db);
  const compact = JSON.stringify(envelope);
  assert.ok(Buffer.byteLength(compact, 'utf8') > 2000000);
  assert.ok(Buffer.byteLength(compact, 'utf8') < D.MAX_BACKUP_BYTES);
  const restored = D.parseBackup(compact);
  assert.deepEqual(restored, envelope.data);
  const storage = store('old');
  assert.deepEqual(D.write(storage, db), restored);
  assert.equal(storage.writes, 1);
});

test('oversized exports and writes are rejected before storage is touched', () => {
  const db = legacy();
  const example = { ...db.inspections[0], notes: 'a'.repeat(1500) };
  db.inspections = Array.from({ length: 6500 }, (_, index) => ({ ...example, id: 'inspection-' + index, steps: example.steps.slice() }));
  assert.throws(() => D.makeBackup(db), /limite de 10 MB/);
  const storage = store('original data');
  assert.throws(() => D.write(storage, db), /limite de 10 MB/);
  assert.equal(storage.writes, 0);
  assert.equal(storage.value, 'original data');
});

test('import limit counts UTF-8 bytes, including emoji and lone surrogates, instead of JavaScript string length', () => {
  const minimum = JSON.stringify(D.makeBackup(D.fresh()));
  const exact = minimum + ' '.repeat(D.MAX_BACKUP_BYTES - Buffer.byteLength(minimum, 'utf8'));
  assert.equal(D.parseBackup(exact).schemaVersion, 2);
  assert.throws(() => D.parseBackup(exact + ' '), /limite de 10 MB/);
  // Unknown envelope fields are ignored by the schema, so they can exercise
  // Unicode byte accounting independently of individual record text limits.
  const padding = 'é😀\ud800'.repeat(1200000);
  const raw = minimum.slice(0, -1) + ',"padding":"' + padding + '"}';
  assert.ok(raw.length < D.MAX_BACKUP_BYTES);
  assert.ok(Buffer.byteLength(raw, 'utf8') > D.MAX_BACKUP_BYTES);
  assert.throws(() => D.parseBackup(raw), /limite de 10 MB/);
});

test('domain also exposes the API as a classic browser script without production dependencies', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../domain.js'), 'utf8'), context);
  assert.equal(context.GodoyData.KEY, 'godoy_manager_v1');
  assert.equal(context.GodoyData.fresh().schemaVersion, 2);
  assert.equal(context.GodoyData.STEPS.length, 8);
});
