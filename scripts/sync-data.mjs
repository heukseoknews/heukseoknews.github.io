// data/ (저장소 루트) → public/data/ 복사. 빌드·dev 전에 실행되어 정적 사이트에 JSON이 포함된다.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
rmSync('public/data', { recursive: true, force: true });
mkdirSync('public/data', { recursive: true });
if (existsSync('data')) cpSync('data', 'public/data', { recursive: true });
// 데이터가 아직 없어도 사이트가 오류 없이 뜨도록 빈 인덱스 보장
if (!existsSync('public/data/index.json')) writeFileSync('public/data/index.json', JSON.stringify({ updated_at: null, months: [] }));
