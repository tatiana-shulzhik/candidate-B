import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Row = Record<string, string>;
type Contract = { id: string; contractor: string; amount: bigint; signed: string };
type Work = { id: string; contract: string; title: string; price: bigint; status: string; completed: string; cancelled: string; allocated: bigint };
type Payment = { id: string; contract: string; work: string; amount: bigint; status: string; created: string; paid: string; refunded: string };

function csv(path: string, columns: string[]): Row[] {
  const input = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
  const records: string[][] = []; let record: string[] = [], field = '', quoted = false, closed = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else field += c;
    } else if (c === '"' && field === '' && !closed) quoted = true;
    else if (c === ',' || c === '\n' || c === '\r') {
      record.push(field); field = ''; closed = false;
      if (c !== ',') { records.push(record); record = []; if (c === '\r' && input[i + 1] === '\n') i++; }
    } else { if (closed || c === '"') throw new Error(`${path}: некорректные кавычки CSV`); field += c; }
  }
  if (quoted) throw new Error(`${path}: незакрытые кавычки CSV`);
  if (field !== '' || record.length) { record.push(field); records.push(record); }
  const header = records.shift();
  if (!header || new Set(header).size !== header.length || columns.some(c => !header.includes(c))) throw new Error(`${path}: неверный заголовок`);
  return records.filter(r => !(r.length === 1 && r[0] === '')).map((r, i) => {
    if (r.length !== header.length) throw new Error(`${path}: неверное число полей в записи ${i + 2}`);
    return Object.fromEntries(header.map((h, j) => [h, r[j]]));
  });
}
function required(value: string, label: string): string { if (!value?.trim()) throw new Error(`${label}: пустое значение`); return value; }
function date(value: string, label: string, optional = false): string {
  if (!value && optional) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value + 'T00:00:00Z')) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error(`${label}: неверная дата ${value}`);
  return value;
}
function money(value: string, label: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error(`${label}: неверная сумма ${value}`);
  const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function format(value: bigint): string { const sign = value < 0n ? '-' : ''; const n = value < 0n ? -value : value; return `${sign}${n / 100n}.${String(n % 100n).padStart(2, '0')}`; }
function unique<T>(items: T[], key: (item: T) => string, label: string): void { const ids = new Set<string>(); for (const item of items) { const id = key(item); if (ids.has(id)) throw new Error(`${label}: повторный идентификатор ${id}`); ids.add(id); } }
function cell(s: string): string { return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function display(rows: string[][], asOf: string, csvMode: boolean): void {
  if (csvMode) { for (const row of rows) console.log(row.map(cell).join(';')); return; }
  console.log(`Отчёт на ${asOf} (руб.)`);
  let group: string[][] = [];
  for (const row of rows.slice(1)) {
    group.push(row);
    if (row[0] !== 'итого') continue;
    console.log(`\nДоговор ${row[1]} — ${row[2]}`);
    const headers = ['Работа', 'Название', 'Статус', 'Цена', 'Выплачено', 'Осталось', 'Переплата*'];
    const table = group.filter(r => r[0] === 'работа').map(r => [r[3], r[4], r[5], r[6], r[7], r[8], r[9]].map(v => v.replace(/[\r\n]+/g, ' ')));
    table.push(['ИТОГО', '', '', '', row[7], row[8], row[9]]);
    const widths = headers.map((h, i) => Math.max(h.length, ...table.map(r => r[i].length)));
    const line = (r: string[]) => r.map((v, i) => i >= 3 ? v.padStart(widths[i]) : v.padEnd(widths[i])).join(' | ');
    console.log(line(headers));
    console.log(widths.map(w => '-'.repeat(w)).join('-+-'));
    for (const item of table) console.log(line(item));
    console.log(`Сумма договора: ${row[10]} | Стоимость неотменённых работ: ${row[11]} | Нераспределено: ${row[12]}`);
    group = [];
  }
  if (rows.length === 1) console.log('На указанную дату договоров нет.');
  else console.log('\n* Для отменённой работы здесь показаны все привязанные к ней выплаты; требуется проверка.');
}

function main(): void {
  const args = process.argv.slice(2);
  const csvMode = args.includes('--csv');
  const positional = args.filter(arg => arg !== '--csv');
  const [asOf, directory = 'data', ...extra] = positional;
  if (!asOf || extra.length || args.filter(arg => arg === '--csv').length > 1 || positional.some(arg => arg.startsWith('--'))) throw new Error('Использование: node report.ts YYYY-MM-DD [путь_к_data] [--csv]');
  date(asOf, 'Дата отчёта');
  const contracts = csv(join(directory, 'contracts.csv'), ['contract_id', 'contractor', 'amount', 'signed_at']).map(r => ({ id: required(r.contract_id, 'Договор'), contractor: required(r.contractor, 'Подрядчик'), amount: money(r.amount, r.contract_id), signed: date(r.signed_at, r.contract_id) }));
  const works: Work[] = csv(join(directory, 'works.csv'), ['work_id', 'contract_id', 'title', 'price', 'status', 'completed_at', 'cancelled_at']).map(r => ({ id: required(r.work_id, 'Работа'), contract: required(r.contract_id, r.work_id), title: required(r.title, r.work_id), price: money(r.price, r.work_id), status: r.status, completed: date(r.completed_at, r.work_id, true), cancelled: date(r.cancelled_at, r.work_id, true), allocated: 0n }));
  const payments: Payment[] = csv(join(directory, 'payments.csv'), ['payment_id', 'contract_id', 'work_id', 'purpose', 'amount', 'status', 'created_at', 'paid_at', 'refunded_at']).map(r => ({ id: required(r.payment_id, 'Платёж'), contract: required(r.contract_id, r.payment_id), work: r.work_id, amount: money(r.amount, r.payment_id), status: r.status, created: date(r.created_at, r.payment_id), paid: date(r.paid_at, r.payment_id, true), refunded: date(r.refunded_at, r.payment_id, true) }));
  unique(contracts, x => x.id, 'Договор'); unique(works, x => x.id, 'Работа'); unique(payments, x => x.id, 'Платёж');
  const contractMap = new Map(contracts.map(x => [x.id, x])); const workMap = new Map(works.map(x => [x.id, x]));
  for (const w of works) {
    const c = contractMap.get(w.contract); if (!c) throw new Error(`${w.id}: договор не найден`);
    if (!['planned', 'done', 'cancelled'].includes(w.status) || (w.status === 'done') !== !!w.completed || (w.status === 'cancelled') !== !!w.cancelled || (w.completed && w.completed < c.signed) || (w.cancelled && w.cancelled < c.signed)) throw new Error(`${w.id}: противоречивый статус или дата`);
  }
  for (const p of payments) {
    const c = contractMap.get(p.contract); if (!c) throw new Error(`${p.id}: договор не найден`);
    if (p.work && workMap.get(p.work)?.contract !== p.contract) throw new Error(`${p.id}: работа не найдена в договоре`);
    if (!['paid', 'queued', 'refunded'].includes(p.status) || (p.status === 'queued' && (p.paid || p.refunded)) || (p.status === 'paid' && (!p.paid || p.refunded)) || (p.status === 'refunded' && (!p.paid || !p.refunded)) || p.created < c.signed || (p.paid && p.paid < p.created) || (p.refunded && p.refunded < p.paid)) throw new Error(`${p.id}: противоречивый статус или дата`);
  }
  display(calculateReport(contracts, works, payments, asOf), asOf, csvMode);
}

function calculateReport(contracts: Contract[], works: Work[], payments: Payment[], asOf: string): string[][] {
  const rows: string[][] = [];
  const output = (values: string[]) => rows.push(values);
  // Распределение хранится в копиях, чтобы повторный расчёт не менял исходные работы.
  const reportWorks = works.map(w => ({ ...w, allocated: 0n }));
  const workMap = new Map(reportWorks.map(w => [w.id, w]));
  output(['тип', 'договор', 'подрядчик', 'работа', 'название', 'статус на дату', 'цена работы', 'выплачено', 'осталось оплатить', 'переплата по работе', 'сумма договора', 'стоимость неотменённых работ', 'нераспределено']);
  for (const c of contracts.filter(x => x.signed <= asOf)) {
    const cw = reportWorks.filter(w => w.contract === c.id);
    const active = payments.filter(p => p.contract === c.id && p.paid && p.paid <= asOf && (!p.refunded || p.refunded > asOf));
    const status = (w: Work): string => w.cancelled && w.cancelled <= asOf ? 'отменена' : w.completed && w.completed <= asOf ? 'принята' : 'запланирована';
    let pool = 0n;
    for (const p of active) { if (p.work) workMap.get(p.work)!.allocated += p.amount; else pool += p.amount; }
    const eligible = cw.filter(w => status(w) !== 'отменена').sort((a, b) => {
      const aDate = status(a) === 'принята' ? a.completed : '9999-99-99'; const bDate = status(b) === 'принята' ? b.completed : '9999-99-99';
      return aDate.localeCompare(bDate) || a.id.localeCompare(b.id, 'en');
    });
    for (const w of eligible) { const capacity = w.price > w.allocated ? w.price - w.allocated : 0n; const applied = pool < capacity ? pool : capacity; w.allocated += applied; pool -= applied; }
    let totalPaid = 0n, remaining = 0n, excess = 0n, activePrice = 0n;
    for (const w of cw) {
      const cancelled = status(w) === 'отменена'; const due = !cancelled && w.price > w.allocated ? w.price - w.allocated : 0n;
      const over = cancelled ? w.allocated : w.allocated > w.price ? w.allocated - w.price : 0n;
      totalPaid += w.allocated; remaining += due; excess += over; if (!cancelled) activePrice += w.price;
      output(['работа', c.id, c.contractor, w.id, w.title, status(w), format(w.price), format(w.allocated), format(due), format(over), '', '', '']);
    }
    output(['итого', c.id, c.contractor, '', '', '', '', format(totalPaid + pool), format(remaining), format(excess), format(c.amount), format(activePrice), format(pool)]);
  }
  return rows;
}
try { main(); } catch (error) { console.error(`Ошибка: ${error instanceof Error ? error.message : error}`); process.exitCode = 1; }
