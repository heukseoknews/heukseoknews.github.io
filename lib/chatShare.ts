'use client';
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { AUTH_MODE } from './authConfig';
import { useAccount } from './useAccount';

type Shareable = { id: string; title: string; url: string; source?: string; published_at?: string; cluster_id?: string };

/** 기사 카드 [채팅에 올리기]: 로그인을 켠 빌드에서 로그인한 상태일 때만 함수를 돌려준다(아니면 null → 버튼 없음).
 *  누르면 그 기사 한 건을 첨부 대기 상태(sessionStorage)로 두고 /chat/ 으로 간다. 채팅 화면이 꺼내 입력창 위에 붙인다.
 *  검사·저장 코드(lib/chat.ts)는 누를 때 불러온다(기사 목록 화면의 첫 번들을 늘리지 않게). */
export function useChatShare(): ((a: Shareable, channel: string) => void) | null {
  const acc = useAccount();
  const router = useRouter();
  const share = useCallback((a: Shareable, channel: string) => {
    import('./chat').then(({ articleRefOf, savePending }) => {
      const ref = articleRefOf(a, channel);
      if (!ref) return;
      try { savePending(sessionStorage, ref); } catch { /* 저장소를 못 쓰면 첨부 없이 채팅으로 */ }
      router.push('/chat/');
    }).catch(() => router.push('/chat/'));
  }, [router]);
  return AUTH_MODE !== 'off' && acc.state === 'in' ? share : null;
}
