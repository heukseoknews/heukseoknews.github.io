// 이번 워크플로 실행에서 수집할 채널 목록(매트릭스)을 정한다. 결과: channels=["insurance", ...] (GITHUB_OUTPUT 형식)
//   node scripts/plan-channels.mjs <event_name> [schedule(cron)] [only(쉼표 구분)]
// 규칙: collect:false 채널은 제외. schedule 이벤트면 channel.json schedule_utc 에 그 cron 이 있는 채널만.
//       workflow_dispatch 는 수집 채널 전체(only 를 주면 그중 일부). push 는 수집 없음(빈 목록).
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadChannels(dir = 'channels') {
  return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()
    .map(slug => JSON.parse(readFileSync(`${dir}/${slug}/channel.json`, 'utf8')));
}

export function planChannels(channels, event, schedule = '', only = '') {
  if (event === 'push') return [];
  const want = only.split(',').map(s => s.trim()).filter(Boolean);
  return channels
    .filter(c => c.collect !== false)
    .filter(c => event !== 'schedule' || [].concat(c.schedule_utc ?? []).includes(schedule))
    .filter(c => !want.length || want.includes(c.slug))
    .map(c => c.slug);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [event = '', schedule = '', only = ''] = process.argv.slice(2);
  console.log(`channels=${JSON.stringify(planChannels(loadChannels(), event, schedule, only))}`);
}
