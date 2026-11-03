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
const vacancyReads = api.vacancy; // no application-level vacancy card cache
const searchReads = api.search; // every search goes to the search projection
const coverLetterBytes = 10000;
const applicationBytes = 1000 + coverLetterBytes;
const expiry = 2;
const events = api.vacancyWrite + expiry;
const staticPeak = Math.ceil(6_800_000 * 5 * 0.2 / 3600);
const staticMiss = staticPeak * 0.05;
const day = 86400;
// name, row count/capacity, logical bytes per row, peak read QPS, peak write QPS.
const tables = [
  ['users', 60_000_000, 1000, api.register + api.auth, api.register],
  ['profiles', 60_000_000, 99000, api.resumeWrite, api.register],
  ['companies', 2_670_000, 50000, vacancyReads + api.vacancyWrite + events, api.register * 0.05],
  ['company_members', 2_670_000, 256, api.vacancyWrite + api.employerList + api.resumeRead + api.status, api.register * 0.05],
  // One session lookup + TTL touch per external API request is an upper bound.
  // Creation/deletion allowance and upper expiry rate are budgeted separately.
  ['sessions', 66_000_000, 512, peak, peak + 2 * api.auth],
  ['resumes', 79_600_000, 100000, api.resumeWrite + api.apply + api.resumeRead, api.resumeWrite],
  ['vacancies', 48_129_817, 50000, vacancyReads + api.vacancyWrite + api.apply + expiry + events, events],
  ['applications', 1_131_680_675, applicationBytes, api.apply + api.applicantList + api.employerList + api.resumeRead + api.status, api.apply + api.status],
  ['reference_values', 10000, 256, 1, 1],
  ['idempotency_keys', writes * day, 1024, writes, 3 * writes],
  ['outbox_events', events * day, 1024, events, 5 * events],
  ['event_queue', events * day, 1024, events, 3 * events],
  ['consumer_receipts', events * day, 64, events, 2 * events],
  ['vacancy_search', 778367, 40000, searchReads, events],
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
const section = readme.split('## 5. Логическая схема БД')[1]?.split(/## 6\. Физическая схема БД|## Список источников/)[0];
assert(section, 'section 5 exists');
const diagrams = [...section.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map(match => match[1]);
assert.equal(diagrams.length, 3, 'three native Mermaid ER diagrams');
diagrams.forEach(diagram => assert(diagram.trim().startsWith('erDiagram'), 'ER, not flowchart'));
const er = diagrams.join('\n');
const definitions = [...er.matchAll(/^\s*(\w+)\s*\{\s*$/gm)].map(match => match[1]);
const entities = new Set(tables.map(table => table[0]));
assert.equal(definitions.length, tables.length, 'one definition for each data set');
const compact = value => value.replace(/\s/g, '');
for (const table of tables) {
  const [id] = table;
  const line = section.split('\n').find(line => line.startsWith(`| \`${id}\` |`) && line.split('|').length === 8);
  assert(line, `storage/QPS row: ${id}`);
  assert.equal(compact(line), compact(row(table)), `storage/QPS values: ${id}`);
  assert(definitions.includes(id), `ER entity: ${id}`);
}
for (const definition of definitions) assert(entities.has(definition), `unexpected entity: ${definition}`);
for (const diagram of diagrams) {
  for (const match of diagram.matchAll(/^\s*(\w+)\s+[|o}{.\-]+\s+(\w+)\s*:/gm)) {
    assert(entities.has(match[1]) && entities.has(match[2]), `ER relation: ${match[0]}`);
  }
}
assert(/text\s+cover_letter/.test(er), 'cover letter in application ER entity');
assert(!/!\[.*\]\(docs\/logical-db\.(svg|png)\)/.test(section), 'old image not embedded');
assert(!/`(?:vacancy_cache|search_cache)`/.test(section), 'removed application caches');
assert(/string\s+csrf_token/.test(er), 'server-side CSRF state');
assert(!/refresh_digest|access-токен|JWT/.test(section), 'cookie session model, no bearer-token lifecycle');
assert(section.includes('10 минут'), 'publication search visibility budget');
assert(section.includes(format(totalBytes / 1e12, 3)), 'total logical volume');
assert.equal(tables.find(t => t[0] === 'users')[2] + tables.find(t => t[0] === 'profiles')[2], 100000);
for (const match of readme.matchAll(/\]\(#(source\d+)\)/g)) {
  assert(readme.includes(`id="${match[1]}"`), `source anchor: ${match[1]}`);
}
for (const match of readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
  readFileSync(`${root}${match[1]}`);
}
// The cover letter is sent with the application and returned with resume details;
// list endpoints deliberately exclude its full text.
const daily = [33000,6800000,32300000,77520000,129200,620000,6460000,51900,1700000,434000,372000];
const sizes = [105000,3000,50000,55000,105000,13000,30000,55000,40000,115000,2000];
const dailyGB = daily.reduce((sum,n,i) => sum+n*sizes[i],0)/1e9;
const peakGbps = dailyGB * 0.2 / 3600 * 8;
const channel = Math.ceil(peakGbps*1.3*100)/100;
const dcChannel = Math.ceil(channel/2*(4600/3514)*100)/100;
assert.equal(daily.reduce((a,b)=>a+b,0),126420100);
assert.equal(dailyGB,6239.3995);assert.equal(channel,3.61);assert.equal(dcChannel,2.37);
assert(readme.includes('6 239,3995'));assert(readme.includes('3,61 Гбит/с'));assert(readme.includes('2,37 Гбит/с'));
const baseBytes = 60e6*100000+796e5*100000+267e4*50000+48129817*50000+1131680675*applicationBytes;
assert(readme.includes(format((baseBytes+778367*40000)/1e12,3)), 'updated section 2 storage total');
console.log(JSON.stringify({ status: 'PASS', apiPeak: peak, writeCommands: writes,
  vacancyEvents: events, tables: tables.length, erDiagrams: diagrams.length, applicationBytes,
  totalLogicalTB: totalBytes / 1e12, dailyGB, channelGbps:channel, dcChannelGbps:dcChannel,
  verified: ['input API RPS', 'row counts', 'byte sizes', 'read/write QPS', 'ER entities and references', 'source anchors', 'image links', 'letter storage and network'],
}, null, 2));
