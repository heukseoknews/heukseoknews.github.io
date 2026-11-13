'use client';
import { Bookmark, ChevronDown, EyeOff, ExternalLink, RotateCcw } from 'lucide-react';
import { Article, isSafeUrl } from '../lib/news';
import { useChannel } from '../lib/channelContext';
import { stars } from '../lib/stars';

/** 같은 사건 묶음(대표 카드에만). others: 불러온 같은 묶음 기사(대표 제외), size·sources: 데이터의 묶음 기사 수·매체 수. */
export type CardGroup = {
  others: Article[]; size: number; sources: number;
  /** 필터·검색에 맞은 기사 id. showMatch 일 때 펼친 목록에서 구분한다 */
  matched: Set<string>; showMatch: boolean;
  open: boolean; onToggle: () => void;
  isBookmarked: (id: string) => boolean; isRead: (id: string) => boolean;
};

/** 새 뉴스 탭에만: [치우기](목록에서 빼기)와, '치운 기사 포함'에서 흐린 카드의 [되돌리기]. 읽음·북마크와 별개다. */
export type CardDismiss = { dismissed: boolean; onDismiss: (id: string) => void; onRestore: (id: string) => void };

/** read: 링크를 연 기사(모든 탭에서 제목을 흐리게 + '읽음'). fading: 방금 치워 사라지는 중. */
type Props = { a: Article; bookmarked: boolean; read: boolean; rank?: number; fading?: boolean; group?: CardGroup; dismiss?: CardDismiss; onBookmark: (a: Article) => void; onRead: (id: string) => void };

/** 태그 표기 통일: 유관기관·보험사는 필터와 같은 정식명으로 먼저, 이어서 분류 키워드 태그(같은 이름은 한 번만). */
const tagList = (a: Article) => [...new Set([...(a.orgs ?? []), ...(a.companies ?? []), ...a.tags])].slice(0, 4);

/** 북마크 별을 누를 때만 짧은 '톡' 효과(.pop, app/globals.css bmPop). 같은 버튼을 연달아 눌러도 다시 시작한다 */
const pop = (e: React.MouseEvent<HTMLButtonElement>) => { const el = e.currentTarget; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); };
const unpop = (e: React.AnimationEvent<HTMLButtonElement>) => e.currentTarget.classList.remove('pop');

export default function ArticleCard({ a, bookmarked, read, rank, fading, group, dismiss, onBookmark, onRead }: Props) {
  const { fmt } = useChannel();
  const s = stars(a);
  const listId = `grp-${a.id}`;
  const gone = !!dismiss?.dismissed;
  return <article data-bm-id={a.id} className={'article' + (read ? ' isRead' : '') + (gone ? ' isDismissed' : '') + (fading ? ' fading' : '')}><div className="articleMain">
    {/* 위계: 분류 배지 줄 → 제목 → 출처·시간 → 중요도·태그 → 같은 사건 */}
    <div className="cardTop">
      {rank !== undefined && <span className="rank">{rank}</span>}
      <span className={a.source_type === 'press' ? 'pill official' : 'pill'}>{a.category}</span>
    </div>
    <h3 className="cardTitle">{isSafeUrl(a.url)
      ? <a className="headline" href={a.url} target="_blank" rel="noopener noreferrer" onClick={() => onRead(a.id)} onAuxClick={e => { if (e.button === 1) onRead(a.id); }}>{a.title}<ExternalLink size={15} aria-hidden="true" /></a>
      : <span className="headline">{a.title} <small>(링크 없음)</small></span>}</h3>
    <div className="meta"><span>{a.source}</span><span className="dot" aria-hidden="true">·</span><time dateTime={a.published_at}>{fmt(a.published_at)}</time></div>
    <div className="bottomMeta"><span>학습 중요도 {'★'.repeat(s)}{'☆'.repeat(Math.max(0, 5 - s))}</span>{tagList(a).map(t => <span className="tag" key={t}>#{t}</span>)}{read && <span className="read">읽음</span>}{gone && <span className="read">치움</span>}</div>
    {group && group.size > 1 && (group.others.length
      ? <button type="button" className="groupToggle" aria-expanded={group.open} aria-controls={listId} onClick={group.onToggle}>
          같은 사건 {group.size.toLocaleString()}건{group.sources > 1 && <> · 매체 {group.sources}곳</>}<ChevronDown size={16} aria-hidden="true" className={group.open ? 'flip' : undefined} />
        </button>
      : <span className="groupToggle static">같은 사건 {group.size.toLocaleString()}건{group.sources > 1 && <> · 매체 {group.sources}곳</>}</span>)}
    {group && group.open && group.others.length > 0 && <ul className="groupList" id={listId}>
      {group.others.map(o => {
        const hit = group.showMatch && group.matched.has(o.id);
        const bm = group.isBookmarked(o.id);
        return <li key={o.id} className={hit ? 'hit' : undefined}>
          <div className="groupItem">
            <div className="groupMeta">{hit && <span className="hitTag">일치</span>}<span>{o.source}</span><span className="dot" aria-hidden="true">·</span><time dateTime={o.published_at}>{fmt(o.published_at)}</time>{group.isRead(o.id) && <span className="read">읽음</span>}</div>
            {isSafeUrl(o.url)
              ? <a className="groupTitle" href={o.url} target="_blank" rel="noopener noreferrer" onClick={() => onRead(o.id)} onAuxClick={e => { if (e.button === 1) onRead(o.id); }}>{o.title}</a>
              : <span className="groupTitle">{o.title}</span>}
          </div>
          <button type="button" className="bookmark small" aria-label={bm ? '북마크 해제' : '북마크 추가'} aria-pressed={bm} onClick={e => { pop(e); onBookmark(o); }} onAnimationEnd={unpop}><Bookmark size={18} className={bm ? 'saved' : undefined} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>}
  </div>
    <div className="cardActions">
      {dismiss && (gone
        ? <button type="button" aria-label="되돌리기(새 뉴스에 다시 보이기)" title="되돌리기" className="readBtn dismissBtn" onClick={() => dismiss.onRestore(a.id)}><RotateCcw size={19} aria-hidden="true" /></button>
        : <button type="button" aria-label="치우기(새 뉴스에서 빼기)" title="치우기" className="readBtn dismissBtn" onClick={() => dismiss.onDismiss(a.id)}><EyeOff size={19} aria-hidden="true" /></button>)}
      <button type="button" aria-label={bookmarked ? '북마크 해제' : '북마크 추가'} aria-pressed={bookmarked} className="bookmark" onClick={e => { pop(e); onBookmark(a); }} onAnimationEnd={unpop}><Bookmark size={20} className={bookmarked ? 'saved' : undefined} aria-hidden="true" /></button>
    </div>
  </article>;
}
