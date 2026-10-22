import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Logical operations, not measurements of a particular database engine.
const root = fileURLToPath(new URL('../', import.meta.url));
const api = {
  register: 2, auth: 378, search: 1795, vacancy: 4307, resumeWrite: 8,
  apply: 35, applicantList: 359, vacancyWrite: 3, employerList: 95,
  resumeRead: 25, status: 21,
};
const peak = Object.values(api).reduce((sum, value) => sum + value, 0);
const writes = api.register + api.resumeWrite + api.apply + api.vacancyWrite + api.status;
const vacancyMiss = api.vacancy * 0.1;
const searchMiss = api.search * 0.8;
const expiry = 2;
const events = api.vacancyWrite + expiry;
const staticPeak = Math.ceil(6_800_000 * 5 * 0.2 / 3600);
const staticMiss = staticPeak * 0.05;
const day = 86400;
// name, row count/capacity, logical bytes per row, peak read QPS, peak write QPS.
const tables = [
  ['users', 60_000_000, 1000, api.register + api.auth, api.register],
  ['profiles', 60_000_000, 99000, api.resumeWrite, api.register],
  ['companies', 2_670_000, 50000, vacancyMiss + api.vacancyWrite + events, api.register * 0.05],
  ['company_members', 2_670_000, 256, api.vacancyWrite + api.employerList + api.resumeRead + api.status, api.register * 0.05],
  ['sessions', 66_000_000, 512, api.auth, 2 * api.auth],
  ['resumes', 79_600_000, 100000, api.resumeWrite + api.apply + api.resumeRead, api.resumeWrite],
  ['vacancies', 48_129_817, 50000, vacancyMiss + api.vacancyWrite + api.apply + expiry + events, events],
  ['applications', 1_131_680_675, 1000, api.apply + api.applicantList + api.employerList + api.resumeRead + api.status, api.apply + api.status],
  ['reference_values', 10000, 256, 1, 1],
  ['idempotency_keys', writes * day, 1024, writes, 3 * writes],
  ['outbox_events', events * day, 1024, events, 3 * events],
  ['event_queue', events * day, 1024, events, 3 * events],
  ['consumer_receipts', events * day, 64, events, 2 * events],
  ['vacancy_search', 778367, 40000, searchMiss, events],
  ['vacancy_cache', 778367, 55000, api.vacancy, 2 * vacancyMiss + events],
  ['search_cache', searchMiss * 30, 50000, api.search, 2 * searchMiss],
  ['reference_cache', 10000, 256, api.search + api.resumeWrite + api.vacancyWrite, 1],
  ['rate_limit_counters', peak * 2 * 60, 128, 0, peak * 4],
  ['file_metadata', 2000, 512, 1, 2],
  ['file_objects', 2000, 100000, staticMiss, 2],
  ['cdn_cache', 2000, 100000, staticPeak, 2 * staticMiss],
  ['request_log_buffer', peak * 900, 512, peak, peak * 2],
  ['request_logs', 126_420_100 * 7, 512, 10, peak * 2],
];
const format = (n, digits = 0) => n.toLocaleString('ru-RU', {
  minimumFractionDigits: digits, maximumFractionDigits: digits,
}).replaceAll('\u00a0', ' ');
const row = ([id, count, bytes, reads, writes]) =>
  `| \`${id}\` | ${format(count)} | ${format(bytes)} | ${format(count * bytes / 1e9, 3)} | ${format(reads, 2)} | ${format(writes, 2)} |`;
const totalBytes = tables.reduce((sum, [, count, bytes]) => sum + count * bytes, 0);
assert.equal(peak, 7028);
assert.equal(writes, 69);
assert.equal(events, 5);
assert.equal(staticPeak, 1889);
if (process.argv.includes('--table')) {
  console.log(tables.map(row).join('\n'));
  console.log(`TOTAL: ${format(totalBytes / 1e12, 6)} TB`);
  process.exit(0);
}

const readme = readFileSync(`${root}README.md`, 'utf8');
const rpsSection = readme.split('#### RPS')[1]?.split('#### Сетевой трафик')[0];
const names = ['Регистрация', 'Авторизация и обновление сессии', 'Поиск вакансий',
  'Просмотр вакансии', 'Создание или изменение резюме', 'Отправка отклика',
  'Просмотр своих откликов', 'Создание или изменение вакансии',
  'Просмотр входящих откликов', 'Просмотр резюме кандидата', 'Изменение статуса отклика'];
names.forEach((name, index) => {
  const line = rpsSection?.split('\n').find(line => line.startsWith(`| ${name} |`));
  assert(line, `input API: ${name}`);
  const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
  assert.equal(Number(cells.at(-1).replace(/\s/g, '')), Object.values(api)[index], `input RPS: ${name}`);
});
const section = readme.split('## 5. Логическая схема БД')[1]?.split('## Список источников')[0];
assert(section, 'section 5 exists');
const svg = readFileSync(`${root}docs/logical-db.svg`, 'utf8');
const compact = value => value.replace(/\s/g, '');
for (const table of tables) {
  const [id] = table;
  const line = section.split('\n').find(line => line.startsWith(`| \`${id}\` |`) && line.split('|').length === 8);
  assert(line, `storage/QPS row: ${id}`);
  assert.equal(compact(line), compact(row(table)), `storage/QPS values: ${id}`);
  assert(svg.includes(`data-entity="${id}"`), `diagram entity: ${id}`);
}
assert.equal((svg.match(/data-entity=/g) || []).length, tables.length, 'all diagram cards accounted for');
const entities = new Set(tables.map(table => table[0]));
for (const match of svg.matchAll(/(?:FK|REF) → (\w+)/g)) {
  assert(entities.has(match[1]), `reference target: ${match[1]}`);
}
assert(section.includes(format(totalBytes / 1e12, 3)), 'total logical volume');
assert.equal(tables.find(t => t[0] === 'users')[2] + tables.find(t => t[0] === 'profiles')[2], 100000);
for (const match of readme.matchAll(/\]\(#(source\d+)\)/g)) {
  assert(readme.includes(`id="${match[1]}"`), `source anchor: ${match[1]}`);
}
for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  readFileSync(`${root}${match[1]}`);
}
const png = readFileSync(`${root}docs/logical-db.png`);
assert.equal(png.readUInt32BE(16), 4400);
assert.equal(png.readUInt32BE(20), 5000);
console.log(JSON.stringify({ status: 'PASS', apiPeak: peak, writeCommands: writes,
  vacancyEvents: events, tables: tables.length, totalLogicalTB: totalBytes / 1e12,
  verified: ['input API RPS', 'row counts', 'byte sizes', 'read/write QPS', 'diagram entities and references', 'source anchors', 'image links', 'PNG dimensions'],
}, null, 2));
