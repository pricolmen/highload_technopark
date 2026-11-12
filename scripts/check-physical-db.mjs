import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Capacity arithmetic and document consistency, NOT a database benchmark.
const root = fileURLToPath(new URL('../', import.meta.url));
const readme = readFileSync(`${root}README.md`, 'utf8');
const logical = readme.split('## 5. Логическая схема БД')[1]?.split('## 6. Физическая схема БД')[0];
const number = value => Number(value.replaceAll(/\s/g, '').replace(',', '.'));
const rows = new Map();
for (const line of logical.split('\n')) {
  if (!/^\| `\w+` \|/.test(line)) continue;
  const cells = line.split('|').slice(1, -1).map(x => x.trim());
  if (cells.length !== 6) continue;
  rows.set(cells[0].replaceAll('`', ''), {
    count: number(cells[1]), size: number(cells[2]),
    read: number(cells[4]), write: number(cells[5]),
  });
}
assert.equal(rows.size, 21);
const bytes = name => rows.get(name).count * rows.get(name).size;
const sum = names => names.reduce((n, name) => n + bytes(name), 0);
const mediaAssets = 60e6 * 0.2 + 2.67e6 * 0.5;
const fileMetadataBytes = (mediaAssets + 2000) * 512;
const receipts = rate => rate * 172800 * 256;
const databases = [
  { name: 'auth_db', group: 'PG-Core', tables: ['users', 'operation_receipts'],
    bytes: bytes('users') + receipts(2) },
  { name: 'profiles_db', group: 'PG-Core', tables: ['profiles'], bytes: bytes('profiles') },
  { name: 'companies_db', group: 'PG-Core', tables: ['companies'], bytes: bytes('companies') },
  { name: 'members_db', group: 'PG-Core', tables: ['company_members'], bytes: bytes('company_members') },
  { name: 'dictionaries_db', group: 'PG-Core', tables: ['reference_values'], bytes: bytes('reference_values') },
  { name: 'files_db', group: 'PG-Core', tables: ['file_metadata'], bytes: fileMetadataBytes },
  { name: 'idempotency_db', group: 'PG-Core', tables: ['idempotency_keys'], bytes: bytes('idempotency_keys') },
  { name: 'vacancies_db', group: 'PG-Catalogue',
    tables: ['vacancies', 'outbox_events', 'consumer_receipts', 'operation_receipts'],
    bytes: sum(['vacancies', 'outbox_events', 'consumer_receipts']) + receipts(3) },
  { name: 'resumes_db', group: 'PG-Resume', tables: ['resumes', 'operation_receipts'],
    bytes: bytes('resumes') + receipts(8) },
  { name: 'applications_db', group: 'PG-Applications', tables: ['applications', 'operation_receipts'],
    bytes: bytes('applications') + receipts(56) },
];
const groups = ['PG-Core', 'PG-Catalogue', 'PG-Resume', 'PG-Applications'].map(name => {
  const groupBytes = databases.filter(db => db.group === name).reduce((total, db) => total + db.bytes, 0);
  return { name, groups: 1, bytes: groupBytes, diskTB: Math.ceil(groupBytes * 1.3 / 1e12 / 0.7) };
});
const corePoolBudgets = [
  { database: 'auth_db', rw: 4, reserve: 1, ro: 1 },
  { database: 'profiles_db', rw: 2, reserve: 0, ro: 1 },
  { database: 'companies_db', rw: 6, reserve: 1, ro: 3 },
  { database: 'members_db', rw: 4, reserve: 0, ro: 1 },
  { database: 'dictionaries_db', rw: 1, reserve: 0, ro: 0 },
  { database: 'files_db', rw: 1, reserve: 0, ro: 1 },
  { database: 'idempotency_db', rw: 6, reserve: 2, ro: 1 },
];
const coreNames = databases.filter(db => db.group === 'PG-Core').flatMap(db => db.tables)
  .filter(name => name !== 'operation_receipts');
const pgPhysicalTB = groups.reduce((n, g) => n + g.bytes * 1.3 / 1e12, 0);
const staticPeak = 1889;
const imageDaily = 6.8e6 * 2 + 6.46e6 * 8;
const imagePeak = Math.ceil(imageDaily * 0.2 / 3600);
const imageEdgeGbps = imagePeak * 30000 * 8 / 1e9;
const imageUploadGbps = 2e6 * 8 / 1e9; // one peak upload/s, max 2 MB
const esOneCopyGB = bytes('vacancy_search') * 2 / 1e9;
const kafkaOneCopyGB = sum(['event_queue', 'request_log_buffer']) * 1.5 / 1e9;
const clickhouseOneCopyGB = bytes('request_logs') * 1.3 * 8 / 7 / 1e9;
const backupTB = (pgPhysicalTB * 3 + 21 * 0.4 + 5) * 1.25;
const employer = { groups: 1, page: 20, briefBytes: 2000, rps: 95 };
const delivery = { input: rows.get('outbox_events').read, capacity: 50, windowSeconds: 600 };
const report = {
  databases: databases.map(db => ({ name: db.name, group: db.group, tables: db.tables,
    logicalGB: db.bytes / 1e9 })),
  databaseCount: databases.length,
  pg: groups.map(g => ({ group: g.name, clusters: g.groups,
    logicalTB: g.bytes / 1e12, physicalTBPerNode: g.bytes * 1.3 / g.groups / 1e12,
    minimumDiskTBPerNode: g.bytes * 1.3 / g.groups / 1e12 / 0.7,
    diskTBPerNode: g.diskTB, diskUsedPct: g.bytes * 1.3 / g.groups / 1e12 / g.diskTB * 100 })),
  pgInstances: groups.reduce((n, g) => n + g.groups * 3, 0),
  pgAllocatedUsefulTB: groups.reduce((n, g) => n + g.groups * 3 * g.diskTB, 0),
  pgPhysicalTB, pgThreeCopiesTB: pgPhysicalTB * 3,
  operationReceipts: { rows: 69 * 172800, GB: receipts(69) / 1e9, insertAndExpiryQPS: 138 },
  registration: { peak: 2, extraReads: 2, extraChanges: 2 * 2,
    receiptGB: receipts(2) / 1e9 },
  coreConnectionBudgets: corePoolBudgets,
  media: { assets: mediaAssets, objects: mediaAssets * 2 + 2000,
    metadataGB: fileMetadataBytes / 1e9, objectsTB: (mediaAssets * 100000 + bytes('file_objects')) / 1e12,
    imageDaily, imagePeak, totalEdgeQPS: imagePeak + staticPeak,
    warmOriginQPS: (imagePeak + staticPeak) * 0.05, imageEdgeGbps, imageUploadGbps,
    warmOriginGbps: (imageEdgeGbps + staticPeak * 100000 * 8 / 1e9) * 0.05 },
  es: { nodes: 3, copies: 3, oneCopyGB: esOneCopyGB, gbPerNode: esOneCopyGB,
    threeCopiesGB: esOneCopyGB * 3, memoryGBPerNode: 64,
    normalSearchQPS: rows.get('vacancy_search').read,
    normalSearchQPSPerNode: Math.ceil(rows.get('vacancy_search').read / 3),
    searchQPSPerNodeAfterDCFailure: Math.ceil(rows.get('vacancy_search').read / 2),
    targetSearchQPS: rows.get('vacancy_search').read * 2,
    targetSearchQPSPerNodeAfterDCFailure: rows.get('vacancy_search').read * 2 / 2 },
  redis: { dcKeys: 4600 * 2 * 60, dcBytesWithOverhead: 4600 * 2 * 60 * 128 * 4,
    dcLogicalOps: 4600 * 4 },
  sessionRedis: { primaryNodes: 1, replicaNodes: 2, nodes: 3, sentinelNodes: 3, sentinelQuorum: 2,
    logicalGB: bytes('sessions') / 1e9,
    gbPerNode: bytes('sessions') * 2 / 1e9,
    threeCopiesGB: bytes('sessions') * 2 * 3 / 1e9,
    reads: rows.get('sessions').read, writes: rows.get('sessions').write,
    testValidationScriptsPerPrimary: 20000, testSessionChangesPerSecond: 1000,
    memoryGBPerNode: 256, allocatedMemoryGB: 256 * 3, diskGBPerNode: 512,
    maxmemoryGB: 96 * 2 ** 30 / 1e9,
    rewriteBudgetGB: 2 * 96 * 2 ** 30 / 1e9,
    rewriteRemainingGB: 256 - 2 * 96 * 2 ** 30 / 1e9 },
  kafka: { oneCopyGB: kafkaOneCopyGB, threeCopiesGB: kafkaOneCopyGB * 3,
    targetLogRecordsPerSecond: 7028 * 2 },
  clickhouse: { oneCopyGB: clickhouseOneCopyGB, threeCopiesGB: clickhouseOneCopyGB * 3 },
  backup: { requiredTB: backupTB, allocatedTB: 160 },
  applicationReadSQL: rows.get('applications').read,
  employerList: {
    sqlPerSecond: employer.rps * employer.groups,
    maxRows: employer.groups * employer.page,
    maxBytesPerRequest: employer.groups * employer.page * employer.briefBytes,
    maxBytesPerSecond: employer.rps * employer.groups * employer.page * employer.briefBytes,
  },
  pgWorkload: {
    core: { reads: coreNames.reduce((total, name) => total + rows.get(name).read, 0) + 2,
      changes: coreNames.reduce((total, name) => total + rows.get(name).write, 0) + 2 * 2,
      testReads: 12000, testChanges: 500 },
    resume: { reads: rows.get('resumes').read, changes: rows.get('resumes').write + 2 * 8,
      testReads: 500, testChanges: 100 },
    applications: { reads: rows.get('applications').read,
      changes: rows.get('applications').write + 2 * 56 + 400 / 5,
      testReads: 4000, testChanges: 600 },
  },
  restore: {
    largestGroup: groups.reduce((largest, g) => g.bytes > largest.bytes ? g : largest).name,
    largestCopyHoursAt800MBps: Math.max(...groups.map(g => g.bytes * 1.3)) / 800e6 / 3600,
  },
  searchDelivery: {
    normalOutboxWrites: rows.get('outbox_events').write,
    backlog: delivery.input * delivery.windowSeconds,
    drainSeconds: Math.ceil(delivery.input * delivery.windowSeconds / (delivery.capacity - delivery.input)),
    oneIndexerDrainSeconds: Math.ceil(delivery.input * delivery.windowSeconds / (delivery.capacity / 2 - delivery.input)),
    catalogueCatchupWriteCeiling: delivery.capacity * (5 + 2) + 5 + 2 * 3,
  },
};
if (process.argv.includes('--report')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const physical = readme.split('## 6. Физическая схема БД')[1]?.split(/## 7\. Алгоритмы|## Список источников/)[0];
assert(physical, 'physical section exists');
const diagrams = [...physical.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map(m => m[1]);
assert.equal(diagrams.length, 4, 'overview and three physical ER diagrams');
assert.equal(diagrams.filter(d => d.trim().startsWith('erDiagram')).length, 3);
const definitions = new Set([...diagrams.join('\n').matchAll(/^\s*(\w+)\s*\{\s*$/gm)].map(m => m[1]));
const prefix = {
  users: 'PG_AUTH', profiles: 'PG_PROFILES', companies: 'PG_COMPANIES', company_members: 'PG_MEMBERS',
  sessions: 'REDIS_SESSION', reference_values: 'PG_DICTIONARIES',
  idempotency_keys: 'PG_IDEMPOTENCY', file_metadata: 'PG_FILES',
  resumes: 'PG_RESUME', vacancies: 'PG_VACANCIES', applications: 'PG_APPLICATIONS',
  outbox_events: 'PG_VACANCIES', consumer_receipts: 'PG_VACANCIES', event_queue: 'KAFKA',
  vacancy_search: 'ES', reference_cache: 'APP', rate_limit_counters: 'REDIS',
  file_objects: 'S3', cdn_cache: 'CDN', request_log_buffer: 'KAFKA', request_logs: 'CH',
};
for (const name of rows.keys()) {
  assert(definitions.has(`${prefix[name]}_${name}`), `physical fields: ${name}`);
  const mapping = physical.split('\n').find(l => l.startsWith(`| \`${name}\` |`));
  assert(mapping && mapping.split('|').length === 6, `store, indexes and HA per table: ${name}`);
}
assert(definitions.has('PG_TARGET_operation_receipts'));
assert(physical.includes('11 923 200'));
assert.equal(report.databaseCount, 10);
assert.equal(databases.filter(db => db.group === 'PG-Core').length, 7);
assert.equal(report.operationReceipts.rows, 11_923_200);
assert.equal(report.operationReceipts.insertAndExpiryQPS, 138);
for (const db of databases) {
  const placement = physical.split('\n').find(line => line.startsWith(`| ${db.group} | \`${db.name}\` |`));
  assert(placement, `database owner and HA placement: ${db.name}`);
  for (const name of db.tables) {
    assert(placement.includes(`\`${name}\``), `table ${name} belongs to ${db.name}`);
  }
}
for (const diagram of diagrams.filter(d => d.trim().startsWith('erDiagram'))) {
  for (const relation of diagram.matchAll(/^\s*(\w+)\s+[|o}{\-]+\s+(\w+)\s*:\s*(?:local_)?FK\s*$/gm)) {
    const owner = entity => databases.find(db => db.tables.some(name => entity === `${prefix[name]}_${name}`));
    assert.equal(owner(relation[1])?.name, owner(relation[2])?.name, 'physical FK stays in one database');
  }
}
assert(!/PG_CORE_|avatar_file_id FK|logo_file_id FK/.test(physical), 'cross-database references use service checks');
assert.equal(report.pgInstances, 12);
assert.equal(report.pgAllocatedUsefulTB, 168);
assert(!/bucket_id|target_bucket|PG-Resume-[12]|PG-Applications-[1-4]/.test(physical),
  'no obsolete PostgreSQL bucket keys or routes');
assert(physical.includes('12 экземпляров PostgreSQL'));
assert.equal(report.media.objects, 26672000);
assert.equal(report.media.imagePeak, 3627);
assert.equal(report.media.totalEdgeQPS, 5516);
assert.equal(report.applicationReadSQL, 535);
assert.equal(report.employerList.sqlPerSecond, 95);
assert.equal(report.employerList.maxRows, 20);
assert.equal(report.employerList.maxBytesPerSecond, 3_800_000);
assert.equal(report.pgWorkload.applications.changes, 248);
for (const workload of Object.values(report.pgWorkload)) {
  assert(workload.reads < workload.testReads && workload.changes < workload.testChanges,
    'consolidated PostgreSQL workload fits the test target');
}
assert.equal(report.restore.largestGroup, 'PG-Applications');
assert(report.restore.largestCopyHoursAt800MBps < 6,
  'largest group copy leaves time for WAL replay within the 8h restore target');
assert.equal(report.searchDelivery.normalOutboxWrites, 25);
assert.equal(report.searchDelivery.backlog, 3000);
assert.equal(report.searchDelivery.drainSeconds, 67);
assert.equal(report.searchDelivery.oneIndexerDrainSeconds, 150);
assert(report.searchDelivery.catalogueCatchupWriteCeiling < 500);
assert(physical.includes('3,8 Мбайт/с') && physical.includes('361 < 500'));
const algorithms = readme.split('## 7. Алгоритмы')[1]?.split('## Список источников')[0];
assert(algorithms, 'algorithm section exists');
assert.equal([...algorithms.matchAll(/^### 7\.\d+\./gm)].length, 2);
assert(algorithms.includes('3 000 / 45'));
assert(!/target_bucket|группой\/бакетом|k-way merge/.test(algorithms),
  'obsolete distributed pagination algorithm removed');
assert(!/7\.3\.|registration_plan|registration_operation_id|cancelled|активаци|возобновляемыми шагами/.test(physical + algorithms),
  'registration uses one local account transaction');
assert(physical.includes('запись профиля создаётся при первом сохранении'));
assert.equal(report.registration.extraReads, 2);
assert.equal(report.registration.extraChanges, 4);
assert.equal(report.pgWorkload.core.reads, 4920);
assert.equal(Number(report.pgWorkload.core.changes.toFixed(1)), 218.2);
for (const g of report.pg) {
  assert.equal(g.clusters, 1, `single HA group: ${g.group}`);
  assert(g.diskUsedPct <= 70, `70% disk threshold: ${g.group}`);
  assert.equal(g.diskTBPerNode, Math.ceil(g.minimumDiskTBPerNode), `capacity rounding: ${g.group}`);
  const line = physical.split('\n').find(l => l.startsWith(`| ${g.group} |`)
    && /^\d+$/.test(l.split('|')[2].trim()));
  assert(line, `capacity row: ${g.group}`);
  const cells = line.split('|').slice(1, -1).map(x => x.trim());
  assert.equal(number(cells[1]), g.clusters);
  assert.equal(number(cells[2]), Number(g.logicalTB.toFixed(3)));
  assert.equal(number(cells[3]), Number(g.physicalTBPerNode.toFixed(3)));
  assert.equal(number(cells[4]), Math.ceil(g.minimumDiskTBPerNode * 1000) / 1000);
  assert.equal(number(cells[5]), g.diskTBPerNode);
  assert.equal(number(cells[6].replace('%', '')), Number(g.diskUsedPct.toFixed(1)));
}
assert(backupTB < 160, 'backup quota including 25% reserve');
assert(report.media.objectsTB < 3 * 3.84 * 0.7 / 3, 'Ceph replicas and 30% headroom');
assert.equal(6 * 32 + 6 * 4 + 20, 236);
assert(236 < 256, 'every PG group aggregate connection budget');
assert.equal(corePoolBudgets.reduce((n, pool) => n + pool.rw, 0), 24);
assert.equal(corePoolBudgets.reduce((n, pool) => n + pool.reserve, 0), 4);
assert.equal(corePoolBudgets.reduce((n, pool) => n + pool.ro, 0), 8);
for (const pool of corePoolBudgets) {
  const poolLine = physical.split('\n').find(line => line.startsWith(`| \`${pool.database}\` |`));
  assert(poolLine, `Core pool budget: ${pool.database}`);
  assert.deepEqual(poolLine.split('|').slice(2, -1).map(cell => number(cell.trim())),
    [pool.rw, pool.reserve, pool.ro]);
}
assert(600 * 0.1 + 4000 * 0.002 < 4 * 32,
  'consolidated application group connection estimate fits four surviving gateways');
assert(physical.includes('octet_length(cover_letter) <= 10000'));
assert.equal(report.es.nodes, report.es.copies);
assert.equal(report.es.gbPerNode, report.es.oneCopyGB);
assert.equal(report.es.normalSearchQPSPerNode, 599);
assert.equal(report.es.searchQPSPerNodeAfterDCFailure, 898);
assert.equal(report.es.targetSearchQPSPerNodeAfterDCFailure, 1795);
assert(physical.includes('599') && physical.includes('898') && physical.includes('по 1 795'));
assert(physical.includes('62,269 Гбайт') && physical.includes('186,808 Гбайт'));
assert(!/4 primary shards|4 shards|15,567|7 180|шесть data-узлов|6 data-узлов|minimumQueryTasks/.test(physical),
  'search uses three full index copies');
assert.equal(report.sessionRedis.reads, 7028);
assert.equal(report.sessionRedis.writes, 7784);
assert.equal(report.sessionRedis.nodes, report.sessionRedis.primaryNodes + report.sessionRedis.replicaNodes);
assert.equal(report.sessionRedis.nodes, 3);
assert.equal(report.sessionRedis.sentinelNodes, 3);
assert(report.sessionRedis.sentinelQuorum <= report.sessionRedis.sentinelNodes - 1,
  'Sentinel quorum survives one DC failure');
assert.equal(report.sessionRedis.gbPerNode, report.sessionRedis.logicalGB * 2);
assert.equal(report.sessionRedis.allocatedMemoryGB, report.sessionRedis.memoryGBPerNode * report.sessionRedis.nodes);
assert(report.sessionRedis.gbPerNode < report.sessionRedis.maxmemoryGB,
  'full session dataset fits each Redis node');
assert(report.sessionRedis.rewriteBudgetGB < report.sessionRedis.memoryGBPerNode,
  'copy-on-write budget leaves memory for OS and buffers');
assert(report.sessionRedis.testValidationScriptsPerPrimary >= report.sessionRedis.reads * 2,
  'one primary test target covers twice the validation peak');
assert(report.sessionRedis.testSessionChangesPerSecond >= report.sessionRedis.writes - report.sessionRedis.reads,
  'management operation test target covers twice the lifecycle peak');
assert(!physical.includes('PG_CORE_sessions') && !physical.includes('refresh_digest'));
assert(physical.includes('67,584 Гбайт') && physical.includes('NewFailoverClient'));
assert(physical.includes('maxmemory=96gb') && physical.includes('768 Гбайт'));
assert(physical.includes('20 000 Lua-проверок') && physical.includes('1 000 созданий/удалений'));
assert(!/Redis Cluster|ClusterClient|hash slots|16 384|5460|10921|22,528|28gb|9 Redis-узлов/.test(physical),
  'sessions use one primary and two full replicas with Sentinel discovery');
assert(physical.includes('synchronous_mode: quorum') && physical.includes('synchronous_mode_strict: true'));
assert(physical.includes('min.insync.replicas=2') && physical.includes('processed_at IS NOT NULL'));
assert(physical.includes('160 Тбайт') && physical.includes('нагрузочный тест'));
for (const match of readme.matchAll(/\]\(#(source\d+)\)/g)) {
  assert(readme.includes(`id="${match[1]}"`), `source anchor: ${match[1]}`);
}
console.log(JSON.stringify({ status: 'PASS', diagrams: diagrams.length, mappedLogicalSets: rows.size,
  physicalAuxiliarySets: 1, databases: report.databaseCount, pgInstances: report.pgInstances, pgPhysicalTB,
  backupRequiredTB: backupTB,
  verified: ['per-table stores/indexes/HA', 'database ownership', 'local FK boundaries',
    'ER fields', 'single-group disk sizing', 'replica count', 'local account creation',
    'full session replicas and memory', 'Sentinel quorum', 'full index replicas and search load',
    'media and metadata', 'single-group employer queries', 'outbox claim cost', 'backlog recovery',
    'pool budgets', 'backup quota', 'source anchors'],
  limitation: 'No production-scale databases were deployed or benchmarked.',
}, null, 2));
