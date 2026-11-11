export type VersionInfo = {
  commit: string; commit_message: string; built_at: string; run_id: string | null; trigger: string; data_collected_at: string | null;
};

/** '2026-11-05T14:02:11+09:00' → '2026.11.05 14:02' (이미 KST 표기이므로 문자열 그대로 변환) */
export function formatBuild(builtAt: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(builtAt);
  return m ? `${m[1]}.${m[2]}.${m[3]} ${m[4]}:${m[5]}` : builtAt;
}

const TRIGGERS: Record<string, string> = { schedule: '예약 수집', workflow_dispatch: '수동 실행', push: '코드 반영', local: '로컬' };
export const triggerLabel = (t: string) => TRIGGERS[t] ?? t;
