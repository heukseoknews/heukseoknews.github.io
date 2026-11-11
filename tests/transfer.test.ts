import assert from 'node:assert/strict';
import { HASH_MAX_CHARS, decodePayload, encodePayload, fromBase64Url, readImportHash, toBase64Url } from '../lib/transfer.ts';
import { EMPTY_STATE, toExportFile } from '../lib/userState.ts';

// base64url 왕복(+, /, = 없음)
const bytes = new Uint8Array(256).map((_, i) => i);
const b = toBase64Url(bytes);
assert.ok(/^[A-Za-z0-9_-]+$/.test(b));
assert.deepEqual(fromBase64Url(b), bytes);
assert.throws(() => fromBase64Url('ab+c'), /잘못된 문자/);

// gzip+base64url 왕복(한글 포함)
const obj = toExportFile('insurance', { ...EMPTY_STATE, companies: ['삼성생명'], readAt: { a: '2026-11-01T00:00:00.000Z' } });
assert.deepEqual(await decodePayload(await encodePayload(obj)), obj);
await assert.rejects(decodePayload('AAAA'));

// 압축 폭탄: 풀었을 때 5MB 를 넘으면 거절
const bomb = await encodePayload({ x: '0'.repeat(6 * 1024 * 1024) });
assert.ok(bomb.length < 20000);
await assert.rejects(decodePayload(bomb), /너무 큽니다/);

// 해시 읽기
assert.equal(readImportHash('#import=abc_-1'), 'abc_-1');
assert.equal(readImportHash('import=abc'), 'abc');
assert.equal(readImportHash('#other=1'), null);
assert.equal(readImportHash(''), null);

// 길이 기준(docs/migration-localstorage.md): 읽음 1,500건이면 기준을 넘어 파일 방식, 300건 + 북마크 10건은 링크로 가능
const hex = (i: number) => (i * 2654435761 % 2 ** 32).toString(16).padStart(8, '0') + (i * 40503 % 2 ** 32).toString(16).padStart(8, '0');
const reads = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [hex(i + 1), new Date(Date.UTC(2026, 10, 1) + i * 137_000 + (i % 997)).toISOString()]));
const big = await encodePayload(toExportFile('insurance', { ...EMPTY_STATE, readAt: reads(1500) }));
const small = await encodePayload(toExportFile('insurance', { ...EMPTY_STATE, readAt: reads(300), bookmarks: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [hex(i), { id: hex(i), title: '삼성화재, 캐노피우스 인수 마무리…해외 사업 확대'.repeat(1), url: 'https://news.google.com/rss/articles/CBMi' + 'x'.repeat(180), source: '한국경제', source_type: 'media', published_at: '2026-11-01T00:00:00+00:00', collected_at: '2026-11-01T00:00:00+00:00', category: '손해보험', tags: ['인수'], score: 3, feed_name: '손보사', companies: ['삼성화재'], orgs: [] }])) }));
console.log(`  해시 길이: 읽음 1,500건 ${big.length}자, 읽음 300건+북마크 10건 ${small.length}자 (기준 ${HASH_MAX_CHARS}자)`);
assert.ok(big.length > HASH_MAX_CHARS);
assert.ok(small.length < HASH_MAX_CHARS);
console.log('transfer tests passed');
