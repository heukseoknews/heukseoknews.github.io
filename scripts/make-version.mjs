// 빌드 시점에 public/version.json 생성 — 배포가 실제로 반영됐는지 확인용.
// 배포 URL: /actuary-news-hub/version.json
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Date → 'YYYY-MM-DDTHH:mm:ss+09:00' (KST) */
export function toKstIso(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 19) + '+09:00';
}

const git = (cmd, fallback = '') => { try { return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return fallback; } };

/** data/status.json 에서 마지막으로 수집에 성공한 시각(소스별 last_success_at 중 최신, 없으면 last_run.finished_at) */
export function dataCollectedAt(statusPath = 'data/status.json') {
  if (!existsSync(statusPath)) return null;
  try {
    const s = JSON.parse(readFileSync(statusPath, 'utf8'));
    const ok = Object.values(s.sources ?? {}).map(v => v.last_success_at).filter(Boolean).sort();
    return ok.at(-1) ?? s.last_run?.finished_at ?? null;
  } catch { return null; }
}

export function buildVersion(env = process.env) {
  return {
    commit: git('rev-parse --short=7 HEAD', 'unknown'),
    commit_message: git('log -1 --format=%s', ''),
    built_at: toKstIso(),
    run_id: env.GITHUB_RUN_ID ?? null,
    trigger: env.GITHUB_EVENT_NAME ?? 'local',
    data_collected_at: dataCollectedAt(),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync('public', { recursive: true });
  const v = buildVersion();
  writeFileSync('public/version.json', JSON.stringify(v, null, 2) + '\n');
  console.log('version.json', v);
}
