'use client';
import { Bookmark, Check, ChevronDown, ExternalLink } from 'lucide-react';
import { Article, isSafeUrl } from '../lib/news';
import { isNewArticle } from '../lib/newsFilter';
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

type Props = { a: Article; baseline: string | null; bookmarked: boolean; read: boolean; rank?: number; dim?: boolean; fading?: boolean; group?: CardGroup; onBookmark: (a: Article) => void; onRead: (id: string) => void; onUnread?: (id: string) => void; onMarkRead?: (id: string) => void };

/** 태그 표기 통일: 유관기관·보험사는 필터와 같은 정식명으로 먼저, 이어서 분류 키워드 태그(같은 이름은 한 번만). */
const tagList = (a: Article) => [...new Set([...(a.orgs ?? []), ...(a.companies ?? []), ...a.tags])].slice(0, 4);

export default function ArticleCard({ a, baseline, bookmarked, read, rank, dim, fading, group, onBookmark, onRead, onUnread, onMarkRead }: Props) {
  const { fmt } = useChannel();
  const s = stars(a);
  const listId = `grp-${a.id}`;
  return <article data-bm-id={a.id} className={'article' + (dim && read ? ' isRead' : '') + (fading ? ' fading' : '')}><div className="articleMain">
    {/* 위계: 분류 배지 줄 → 제목 → 출처·시간 → 중요도·태그 → 같은 사건 */}
    <div className="cardTop">
      {rank !== undefined && <span className="rank">{rank}</span>}
      <span className={a.source_type === 'press' ? 'pill official' : 'pill'}>{a.category}</span>
      {baseline && isNewArticle(a, baseline) && <span className="new">새</span>}
    </div>
    <h3 className="cardTitle">{isSafeUrl(a.url)
      ? <a className="headline" href={a.url} target="_blank" rel="noopener noreferrer" onClick={() => onRead(a.id)} onAuxClick={e => { if (e.button === 1) onRead(a.id); }}>{a.title}<ExternalLink size={15} aria-hidden="true" /></a>
      : <span className="headline">{a.title} <small>(링크 없음)</small></span>}</h3>
    <div className="meta"><span>{a.source}</span><span className="dot" aria-hidden="true">·</span><time dateTime={a.published_at}>{fmt(a.published_at)}</time></div>
    <div className="bottomMeta"><span>학습 중요도 {'★'.repeat(s)}{'☆'.repeat(Math.max(0, 5 - s))}</span>{tagList(a).map(t => <span className="tag" key={t}>#{t}</span>)}{read && <span className="read">읽음</span>}{read && onUnread && <button type="button" className="unreadBtn" onClick={() => onUnread(a.id)}>안 읽음으로</button>}</div>
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
          <button type="button" className="bookmark small" aria-label={bm ? '북마크 해제' : '북마크 추가'} aria-pressed={bm} onClick={() => onBookmark(o)}><Bookmark size={18} className={bm ? 'saved' : undefined} aria-hidden="true" /></button>
        </li>;
      })}
    </ul>}
  </div>
    <div className="cardActions">
      {onMarkRead && !read && <button type="button" aria-label="읽음 처리" title="읽음 처리" className="readBtn" onClick={() => onMarkRead(a.id)}><Check size={20} /></button>}
      <button type="button" aria-label={bookmarked ? '북마크 해제' : '북마크 추가'} aria-pressed={bookmarked} className="bookmark" onClick={() => onBookmark(a)}><Bookmark size={20} className={bookmarked ? 'saved' : undefined} aria-hidden="true" /></button>
    </div>
  </article>;
}
