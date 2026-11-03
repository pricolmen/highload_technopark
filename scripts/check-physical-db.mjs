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
const coreNames = ['users', 'profiles', 'companies', 'company_members',
  'reference_values', 'idempotency_keys'];
const groups = [
  { name: 'PG-Core', groups: 1, bytes: sum(coreNames) + fileMetadataBytes, diskTB: 15.36 },
  { name: 'PG-Catalogue', groups: 1,
    bytes: sum(['vacancies', 'outbox_events', 'consumer_receipts']) + receipts(3), diskTB: 7.68 },
  { name: 'PG-Resume', groups: 2, bytes: bytes('resumes') + receipts(8), diskTB: 7.68 },
  { name: 'PG-Applications', groups: 4, bytes: bytes('applications') + receipts(56), diskTB: 7.68 },
];
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
const report = {
  pg: groups.map(g => ({ group: g.name, clusters: g.groups,
    logicalTB: g.bytes / 1e12, physicalTBPerNode: g.bytes * 1.3 / g.groups / 1e12,
    diskTBPerNode: g.diskTB, diskUsedPct: g.bytes * 1.3 / g.groups / 1e12 / g.diskTB * 100 })),
  pgInstances: groups.reduce((n, g) => n + g.groups * 3, 0),
  pgPhysicalTB, pgThreeCopiesTB: pgPhysicalTB * 3,
  operationReceipts: { rows: 67 * 172800, GB: receipts(67) / 1e9, insertAndExpiryQPS: 134 },
  media: { assets: mediaAssets, objects: mediaAssets * 2 + 2000,
    metadataGB: fileMetadataBytes / 1e9, objectsTB: (mediaAssets * 100000 + bytes('file_objects')) / 1e12,
    imageDaily, imagePeak, totalEdgeQPS: imagePeak + staticPeak,
    warmOriginQPS: (imagePeak + staticPeak) * 0.05, imageEdgeGbps, imageUploadGbps,
    warmOriginGbps: (imageEdgeGbps + staticPeak * 100000 * 8 / 1e9) * 0.05 },
  es: { oneCopyGB: esOneCopyGB, shardGB: esOneCopyGB / 4, threeCopiesGB: esOneCopyGB * 3,
    targetSearchQPS: 3590, minimumQueryTasksPerNodeAfterDCFailure: 3590 * 4 / 4 },
  redis: { dcKeys: 4600 * 2 * 60, dcBytesWithOverhead: 4600 * 2 * 60 * 128 * 4,
    dcLogicalOps: 4600 * 4 },
  sessionRedis: { shards: 3, copiesPerShard: 3, nodes: 9,
    logicalGB: bytes('sessions') / 1e9,
    gbPerNode: bytes('sessions') * 2 / 3 / 1e9,
    threeCopiesGB: bytes('sessions') * 2 * 3 / 1e9,
    reads: rows.get('sessions').read, writes: rows.get('sessions').write,
    testValidationScriptsPerShard: 10000, memoryGBPerNode: 64 },
  kafka: { oneCopyGB: kafkaOneCopyGB, threeCopiesGB: kafkaOneCopyGB * 3,
    targetLogRecordsPerSecond: 7028 * 2 },
  clickhouse: { oneCopyGB: clickhouseOneCopyGB, threeCopiesGB: clickhouseOneCopyGB * 3 },
  backup: { requiredTB: backupTB, allocatedTB: 160 },
  applicationReadSQL: rows.get('applications').read + 95 * (4 - 1),
};
if (process.argv.includes('--report')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const physical = readme.split('## 6. Физическая схема БД')[1]?.split('## Список источников')[0];
assert(physical, 'physical section exists');
const diagrams = [...physical.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map(m => m[1]);
assert.equal(diagrams.length, 4, 'overview and three physical ER diagrams');
assert.equal(diagrams.filter(d => d.trim().startsWith('erDiagram')).length, 3);
const definitions = new Set([...diagrams.join('\n').matchAll(/^\s*(\w+)\s*\{\s*$/gm)].map(m => m[1]));
const prefix = {
  users: 'PG_CORE', profiles: 'PG_CORE', companies: 'PG_CORE', company_members: 'PG_CORE',
  sessions: 'REDIS_SESSION', reference_values: 'PG_CORE', idempotency_keys: 'PG_CORE', file_metadata: 'PG_CORE',
  resumes: 'PG_RESUME', vacancies: 'PG_CATALOGUE', applications: 'PG_APPLICATIONS',
  outbox_events: 'PG_CATALOGUE', consumer_receipts: 'PG_CATALOGUE', event_queue: 'KAFKA',
  vacancy_search: 'ES', reference_cache: 'APP', rate_limit_counters: 'REDIS',
  file_objects: 'S3', cdn_cache: 'CDN', request_log_buffer: 'KAFKA', request_logs: 'CH',
};
for (const name of rows.keys()) {
  assert(definitions.has(`${prefix[name]}_${name}`), `physical fields: ${name}`);
  const mapping = physical.split('\n').find(l => l.startsWith(`| \`${name}\` |`));
  assert(mapping && mapping.split('|').length === 6, `store, indexes and HA per table: ${name}`);
}
assert(definitions.has('PG_TARGET_operation_receipts'));
assert(physical.includes('11 577 600'));
assert.equal(report.pgInstances, 24);
assert.equal(report.media.objects, 26672000);
assert.equal(report.media.imagePeak, 3627);
assert.equal(report.media.totalEdgeQPS, 5516);
assert.equal(report.applicationReadSQL, 820);
for (const g of report.pg) {
  assert(g.diskUsedPct < 70, `70% disk threshold: ${g.group}`);
  const line = physical.split('\n').find(l => l.startsWith(`| ${g.group} |`));
  assert(line, `capacity row: ${g.group}`);
  const cells = line.split('|').slice(1, -1).map(x => x.trim());
  assert.equal(number(cells[1]), g.clusters);
  assert.equal(number(cells[2]), Number(g.physicalTBPerNode.toFixed(3)));
  assert.equal(number(cells[3]), g.diskTBPerNode);
}
assert(backupTB < 160, 'backup quota including 25% reserve');
assert(report.media.objectsTB < 3 * 3.84 * 0.7 / 3, 'Ceph replicas and 30% headroom');
assert.equal(6 * 32 + 6 * 4 + 20, 236);
assert(236 < 256, 'every PG group aggregate connection budget');
assert(physical.includes('octet_length(cover_letter) <= 10000'));
assert.equal(report.sessionRedis.reads, 7028);
assert.equal(report.sessionRedis.writes, 7784);
assert.equal(report.sessionRedis.nodes, report.sessionRedis.shards * report.sessionRedis.copiesPerShard);
assert.equal(Math.ceil(bytes('sessions') * 2 / (28 * 2 ** 30)), report.sessionRedis.shards);
assert(report.sessionRedis.gbPerNode < 28 * 2 ** 30 / 1e9);
assert(2 * 28 * 2 ** 30 / 1e9 + 3.5 < report.sessionRedis.memoryGBPerNode,
  'AOF copy-on-write and non-dataset memory fit RAM budget');
assert(!physical.includes('PG_CORE_sessions') && !physical.includes('refresh_digest'));
assert(physical.includes('22,528 Гбайт') && physical.includes('ClusterClient'));
assert(physical.includes('synchronous_mode: quorum') && physical.includes('synchronous_mode_strict: true'));
assert(physical.includes('min.insync.replicas=2') && physical.includes('processed_at IS NOT NULL'));
assert(physical.includes('160 Тбайт') && physical.includes('нагрузочный тест'));
for (const match of readme.matchAll(/\]\(#(source\d+)\)/g)) {
  assert(readme.includes(`id="${match[1]}"`), `source anchor: ${match[1]}`);
}
console.log(JSON.stringify({ status: 'PASS', diagrams: diagrams.length, mappedLogicalSets: rows.size,
  physicalAuxiliarySets: 1, pgInstances: report.pgInstances, pgPhysicalTB,
  backupRequiredTB: backupTB,
  verified: ['per-table stores/indexes/HA', 'ER fields', 'shard capacity', 'replica count',
    'media and metadata', 'employer query fan-out', 'pool budgets', 'backup quota', 'source anchors'],
  limitation: 'No production-scale databases were deployed or benchmarked.',
}, null, 2));
