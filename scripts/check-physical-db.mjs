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
  { name: 'auth_db', group: 'PG-Auth', engine: 'PostgreSQL', tables: ['users', 'operation_receipts'],
    bytes: bytes('users') + receipts(2), cpu: 4, ramGB: 16,
    read: 382, changes: 6, testRead: 1000, testChanges: 50,
    rw: 4, reserve: 1, ro: 0, maxConnections: 96 },
  { name: 'profiles_db', group: 'PG-Profiles', engine: 'PostgreSQL', tables: ['profiles'],
    bytes: bytes('profiles'), cpu: 8, ramGB: 64,
    read: 8, changes: 3, testRead: 100, testChanges: 50,
    rw: 2, reserve: 1, ro: 0, maxConnections: 96 },
  { name: 'companies_db', group: 'PG-Companies', engine: 'PostgreSQL', tables: ['companies'],
    bytes: bytes('companies'), cpu: 8, ramGB: 64,
    read: 4315, changes: 1.1, testRead: 10000, testChanges: 50,
    rw: 8, reserve: 2, ro: 8, maxConnections: 192 },
  { name: 'members_db', group: 'PG-Members', engine: 'PostgreSQL', tables: ['company_members'],
    bytes: bytes('company_members'), cpu: 4, ramGB: 16,
    read: 144, changes: 0.1, testRead: 500, testChanges: 20,
    rw: 4, reserve: 1, ro: 0, maxConnections: 96 },
  { name: 'dictionaries_db', group: 'PG-Dictionaries', engine: 'PostgreSQL', tables: ['reference_values'],
    bytes: bytes('reference_values'), cpu: 2, ramGB: 4,
    read: 1, changes: 1, testRead: 10, testChanges: 10,
    rw: 1, reserve: 1, ro: 0, maxConnections: 64 },
  { name: 'files_db', group: 'PG-Files', engine: 'PostgreSQL', tables: ['file_metadata'],
    bytes: fileMetadataBytes, cpu: 2, ramGB: 8,
    read: 2, changes: 4, testRead: 100, testChanges: 50,
    rw: 2, reserve: 1, ro: 0, maxConnections: 96 },
  { name: 'idempotency_db', group: 'PG-Idempotency', engine: 'PostgreSQL', tables: ['idempotency_keys'],
    bytes: bytes('idempotency_keys'), cpu: 4, ramGB: 16,
    read: 138, changes: 207, testRead: 500, testChanges: 500,
    rw: 16, reserve: 4, ro: 0, maxConnections: 192 },
  { name: 'vacancies_db', group: 'PG-Catalogue', engine: 'PostgreSQL',
    tables: ['vacancies', 'outbox_events', 'consumer_receipts', 'operation_receipts'],
    bytes: sum(['vacancies', 'outbox_events', 'consumer_receipts']) + receipts(3), cpu: 16, ramGB: 128,
    read: 4365, changes: 46, testRead: 10000, testChanges: 500,
    rw: 24, reserve: 4, ro: 8, maxConnections: 256 },
  { name: 'resumes_db', group: 'Mongo-Resume', engine: 'MongoDB', tables: ['resumes', 'operation_receipts'],
    bytes: bytes('resumes') + receipts(8), cpu: 16, ramGB: 128,
    read: 76, changes: 24, testRead: 500, testChanges: 100 },
  { name: 'applications_db', group: 'PG-Applications', engine: 'PostgreSQL',
    tables: ['applications', 'operation_receipts'],
    bytes: bytes('applications') + receipts(56), cpu: 16, ramGB: 128,
    read: 591, changes: 248, testRead: 4000, testChanges: 600,
    rw: 24, reserve: 4, ro: 0, maxConnections: 256 },
];
const groups = databases.filter(db => db.engine === 'PostgreSQL').map(db => {
  const physicalGB = db.bytes * 1.3 / 1e9;
  const minimumDiskGB = physicalGB / 0.7;
  const roundingGB = minimumDiskGB < 1000 ? 100 : 1000;
  const diskGB = Math.max(100, Math.ceil(minimumDiskGB / roundingGB) * roundingGB);
  return { ...db, physicalGB, minimumDiskGB, diskGB };
});
const mongo = databases.find(db => db.engine === 'MongoDB');
const mongoOplogGB = 200;
const mongoPhysicalGB = mongo.bytes * 1.3 / 1e9 + mongoOplogGB;
const mongoDiskGB = Math.ceil(mongoPhysicalGB / 0.7 / 1000) * 1000;
const pgPhysicalTB = groups.reduce((n, g) => n + g.bytes * 1.3 / 1e12, 0);
const mongoPhysicalTB = mongoPhysicalGB / 1000;
const staticPeak = 1889;
const imageDaily = 6.8e6 * 2 + 6.46e6 * 8;
const imagePeak = Math.ceil(imageDaily * 0.2 / 3600);
const imageEdgeGbps = imagePeak * 30000 * 8 / 1e9;
const imageUploadGbps = 2e6 * 8 / 1e9; // one peak upload/s, max 2 MB
const esOneCopyGB = bytes('vacancy_search') * 2 / 1e9;
const kafkaOneCopyGB = sum(['event_queue', 'request_log_buffer']) * 1.5 / 1e9;
const clickhouseOneCopyGB = bytes('request_logs') * 1.3 * 8 / 7 / 1e9;
const backupTB = ((pgPhysicalTB + mongoPhysicalTB) * 3 + 21 * (0.4 + 0.2) + 5) * 1.25;
const backupRolloverTB = backupTB / 1.25 + Math.max(...groups.map(group => group.physicalGB / 1000), mongoPhysicalTB);
const employer = { groups: 1, page: 20, briefBytes: 2000, rps: 95 };
const delivery = { input: rows.get('outbox_events').read, capacity: 50, windowSeconds: 600 };
const report = {
  databases: databases.map(db => ({ name: db.name, group: db.group, engine: db.engine, tables: db.tables,
    logicalGB: db.bytes / 1e9 })),
  databaseCount: databases.length,
  pg: groups.map(g => ({ group: g.group, database: g.name, clusters: 1,
    logicalGB: g.bytes / 1e9, physicalGBPerNode: g.physicalGB,
    minimumDiskGBPerNode: g.minimumDiskGB, diskGBPerNode: g.diskGB,
    diskUsedPct: g.physicalGB / g.diskGB * 100, cpu: g.cpu, ramGB: g.ramGB,
    read: g.read, changes: g.changes, testRead: g.testRead, testChanges: g.testChanges,
    rw: g.rw, reserve: g.reserve, ro: g.ro, maxConnections: g.maxConnections,
    connectionCeiling: 6 * (g.rw + g.reserve + g.ro) + 20,
    connectionsAfterDCFailure: 4 * g.rw,
    estimatedConnectionsAtTestLoad: g.testChanges * 0.1 + g.testRead * 0.002 })),
  pgInstances: groups.length * 3,
  pgAllocatedUsefulTB: groups.reduce((n, g) => n + 3 * g.diskGB / 1000, 0),
  pgPhysicalTB, pgThreeCopiesTB: pgPhysicalTB * 3,
  mongo: { group: mongo.group, database: mongo.name, replicaSet: 'rs-resumes', nodes: 3,
    logicalGB: mongo.bytes / 1e9, physicalGBPerNode: mongoPhysicalGB,
    minimumDiskGBPerNode: mongoPhysicalGB / 0.7, diskGBPerNode: mongoDiskGB,
    diskUsedPct: mongoPhysicalGB / mongoDiskGB * 100,
    oplogGB: mongoOplogGB, oplogBytesPerSecondBudget: 1e6, oplogWindowSeconds: 86400,
    cpu: mongo.cpu, ramGB: mongo.ramGB,
    read: mongo.read, changes: mongo.changes, testRead: mongo.testRead, testChanges: mongo.testChanges,
    receiptRows: 8 * 172800, receiptGB: receipts(8) / 1e9,
    allocatedUsefulTB: 3 * mongoDiskGB / 1000,
    fullRestoreHoursAt800MBps: mongoPhysicalGB * 1e9 / 800e6 / 3600 },
  totalDataInstances: groups.length * 3 + 3,
  totalAllocatedUsefulTB: groups.reduce((n, g) => n + 3 * g.diskGB / 1000, 0) + 3 * mongoDiskGB / 1000,
  operationReceipts: { rows: 69 * 172800, GB: receipts(69) / 1e9, insertAndExpiryQPS: 138 },
  registration: { peak: 2, extraReads: 2, extraChanges: 2 * 2,
    receiptGB: receipts(2) / 1e9 },
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
  backup: { requiredTB: backupTB, allocatedTB: 170,
    pgFullCopiesTB: pgPhysicalTB * 3, mongoFullCopiesTB: mongoPhysicalTB * 3,
    journalAndIncrementTB: 21 * (0.4 + 0.2), peakDuringRolloverTB: backupRolloverTB },
  applicationReadSQL: rows.get('applications').read,
  employerList: {
    sqlPerSecond: employer.rps * employer.groups,
    maxRows: employer.groups * employer.page,
    maxBytesPerRequest: employer.groups * employer.page * employer.briefBytes,
    maxBytesPerSecond: employer.rps * employer.groups * employer.page * employer.briefBytes,
  },
  pgWorkload: {
    applications: { reads: rows.get('applications').read,
      changes: rows.get('applications').write + 2 * 56 + 400 / 5,
      testReads: 4000, testChanges: 600 },
  },
  restore: {
    largestGroup: groups.reduce((largest, g) => g.bytes > largest.bytes ? g : largest).group,
    largestCopyHoursAt800MBps: Math.max(...groups.map(g => g.bytes * 1.3)) / 800e6 / 3600,
    allCopiesHoursAt5GBps: 3 * (pgPhysicalTB + mongoPhysicalTB) * 1e12 / 5e9 / 3600,
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
assert.equal(diagrams.length, 5, 'overview and four physical ER diagrams');
assert.equal(diagrams.filter(d => d.trim().startsWith('erDiagram')).length, 4);
const definitions = new Set([...diagrams.join('\n').matchAll(/^\s*(\w+)\s*\{\s*$/gm)].map(m => m[1]));
const prefix = {
  users: 'PG_AUTH', profiles: 'PG_PROFILES', companies: 'PG_COMPANIES', company_members: 'PG_MEMBERS',
  sessions: 'REDIS_SESSION', reference_values: 'PG_DICTIONARIES',
  idempotency_keys: 'PG_IDEMPOTENCY', file_metadata: 'PG_FILES',
  resumes: 'MONGO_RESUME', vacancies: 'PG_VACANCIES', applications: 'PG_APPLICATIONS',
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
assert(definitions.has('MONGO_RESUME_operation_receipts'));
assert.equal(definitions.size, rows.size + 2);
assert(physical.includes('11 923 200'));
assert.equal(report.databaseCount, 10);
assert.equal(new Set(databases.map(db => db.group)).size, 10, 'one independent group per database');
assert.equal(report.pg.length, 9);
assert.equal(report.mongo.nodes, 3);
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
assert.equal(report.pgInstances, 27);
assert.equal(report.totalDataInstances, 30);
assert.equal(Number(report.pgAllocatedUsefulTB.toFixed(1)), 125.7);
assert.equal(report.totalAllocatedUsefulTB, 173.7);
assert(!/PG-Core|PG-Resume|bucket_id|target_bucket|PG-Applications-[1-4]/.test(physical),
  'no obsolete PostgreSQL bucket keys or routes');
assert(physical.includes('27 экземпляров PostgreSQL и 3 экземпляра MongoDB'));
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
assert(report.restore.allCopiesHoursAt5GBps < 6.5,
  'all replicas fit the aggregate restore transfer budget');
assert(physical.includes('минимум 5 Гбайт/с') && physical.includes('113,566 Тбайт'));
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
const capacitySection = physical.split('#### PostgreSQL — ёмкость независимых групп')[1]
  ?.split('#### MongoDB — ёмкость резюме')[0];
const resourceSection = physical.split('#### Начальная конфигурация узлов')[1]
  ?.split('#### Аватарки и логотипы')[0];
const workloadSection = physical.split('| Группа | Исходный бюджет')[1]
  ?.split('При консервативном пересчёте')[0];
assert(capacitySection && resourceSection && workloadSection);
for (const g of report.pg) {
  assert.equal(g.clusters, 1, `single HA group: ${g.group}`);
  assert(g.diskUsedPct <= 70, `70% disk threshold: ${g.group}`);
  const quantumGB = g.minimumDiskGBPerNode < 1000 ? 100 : 1000;
  assert.equal(g.diskGBPerNode, Math.max(100, Math.ceil(g.minimumDiskGBPerNode / quantumGB) * quantumGB));
  const line = capacitySection.split('\n').find(l => l.startsWith(`| ${g.group} |`));
  assert(line, `capacity row: ${g.group}`);
  const cells = line.split('|').slice(1, -1).map(x => x.trim());
  assert.equal(number(cells[1]), Number(g.logicalGB.toFixed(3)));
  assert.equal(number(cells[2]), Number(g.physicalGBPerNode.toFixed(3)));
  assert.equal(number(cells[3]), Math.ceil(g.minimumDiskGBPerNode * 1000) / 1000);
  assert.equal(number(cells[4]), g.diskGBPerNode);
  assert.equal(number(cells[5].replace('%', '')), Number(g.diskUsedPct.toFixed(1)));
  const resource = resourceSection.split('\n').find(l => l.startsWith(`| ${g.group} |`));
  assert(resource, `resource row: ${g.group}`);
  assert.deepEqual(resource.split('|').slice(2, -1).map(number), [g.cpu, g.ramGB]);
  const workload = workloadSection.split('\n').find(l => l.startsWith(`| ${g.group} |`));
  assert(workload, `workload row: ${g.group}`);
  const loadCells = workload.split('|').slice(2, -1).map(cell => cell.trim().split('/').map(number));
  assert.deepEqual(loadCells, [[g.read, g.changes], [g.testRead, g.testChanges]]);
  assert(g.read <= g.testRead && g.changes <= g.testChanges, `workload target: ${g.group}`);
}
assert.equal(report.mongo.diskGBPerNode, 16000);
assert(report.mongo.diskUsedPct <= 70);
assert(report.mongo.oplogGB * 1e9 >= 2 * report.mongo.oplogBytesPerSecondBudget * report.mongo.oplogWindowSeconds);
assert.equal(report.mongo.receiptRows, 1_382_400);
assert.equal(report.mongo.read, 76);
assert.equal(report.mongo.changes, 24);
assert(report.mongo.read < report.mongo.testRead && report.mongo.changes < report.mongo.testChanges);
assert(report.mongo.fullRestoreHoursAt800MBps < 4);
assert(physical.includes('16 Тбайт на узел') && physical.includes('200 Гбайт'));
assert(physical.includes('_id=resume_id') && physical.includes('owner_user_id:1,updated_at:-1,_id:-1'));
assert(physical.includes('readConcern=linearizable') && physical.includes('readConcern=snapshot'));
assert(physical.includes('writeConcern={w:"majority",j:true}'));
assert(physical.includes('transactionLifetimeLimitSeconds=5'));
assert(physical.includes('Индекс `expires_at` обычный') && physical.includes('При недоступности координатора удаление откладывается'));
assert(algorithms.includes('UnknownTransactionCommitResult') && algorithms.includes('Ошибка duplicate key откатывает'));
assert(physical.includes('Percona Server for MongoDB 8.0') && physical.includes('pitr.oplogSpanMin=1'));
assert(backupTB < report.backup.allocatedTB, 'backup quota including 25% reserve');
assert(backupRolloverTB < report.backup.allocatedTB, 'new base fits before old chain deletion');
assert(physical.includes('pbm backup --type incremental --base'));
assert(report.media.objectsTB < 3 * 3.84 * 0.7 / 3, 'Ceph replicas and 30% headroom');
const poolSection = physical.split('| Группа | Обычные RW')[1]?.split('Предел рассчитывается')[0];
assert(poolSection);
for (const group of report.pg) {
  assert(group.connectionCeiling < group.maxConnections, `connection limit: ${group.group}`);
  assert(group.estimatedConnectionsAtTestLoad < group.connectionsAfterDCFailure,
    `connection capacity after DC loss: ${group.group}`);
  const poolLine = poolSection.split('\n').find(line => line.startsWith(`| ${group.group} |`));
  assert(poolLine, `independent pool budget: ${group.group}`);
  assert.deepEqual(poolLine.split('|').slice(2, -1).map(cell => number(cell.trim())),
    [group.rw, group.reserve, group.ro, group.connectionCeiling, group.maxConnections]);
}
assert(physical.includes('maxPoolSize=16') && physical.includes('18 × I'));
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
assert(physical.includes('170 Тбайт') && physical.includes('нагрузочный тест'));
for (const match of readme.matchAll(/\]\(#(source\d+)\)/g)) {
  assert(readme.includes(`id="${match[1]}"`), `source anchor: ${match[1]}`);
}
console.log(JSON.stringify({ status: 'PASS', diagrams: diagrams.length, mappedLogicalSets: rows.size,
  physicalAuxiliarySets: 2, databases: report.databaseCount, pgInstances: report.pgInstances,
  mongoInstances: report.mongo.nodes, totalDataInstances: report.totalDataInstances, pgPhysicalTB,
  backupRequiredTB: backupTB,
  verified: ['per-table stores/indexes/HA', 'database ownership', 'local FK boundaries',
    'ER fields', 'single-group disk sizing', 'replica count', 'local account creation',
    'full session replicas and memory', 'Sentinel quorum', 'full index replicas and search load',
    'media and metadata', 'single-group employer queries', 'outbox claim cost', 'backlog recovery',
    'independent pool budgets', 'MongoDB indexes and receipts', 'oplog capacity',
    'MongoDB transaction recovery', 'backup quota', 'source anchors'],
  limitation: 'No production-scale databases were deployed or benchmarked.',
}, null, 2));
