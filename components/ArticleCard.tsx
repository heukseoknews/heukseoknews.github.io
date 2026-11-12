'use client';
import { Bookmark, Check, ExternalLink } from 'lucide-react';
import { Article, isSafeUrl } from '../lib/news';
import { isNewArticle } from '../lib/newsFilter';
import { useChannel } from '../lib/channelContext';

type Props = { a: Article; baseline: string | null; bookmarked: boolean; read: boolean; rank?: number; dim?: boolean; fading?: boolean; onBookmark: (a: Article) => void; onRead: (id: string) => void; onUnread?: (id: string) => void; onMarkRead?: (id: string) => void };

/** 태그 표기 통일: 유관기관·보험사는 필터와 같은 정식명으로 먼저, 이어서 분류 키워드 태그(같은 이름은 한 번만). */
const tagList = (a: Article) => [...new Set([...(a.orgs ?? []), ...(a.companies ?? []), ...a.tags])].slice(0, 4);

export default function ArticleCard({ a, baseline, bookmarked, read, rank, dim, fading, onBookmark, onRead, onUnread, onMarkRead }: Props) {
  const { fmt } = useChannel();
  return <article data-bm-id={a.id} className={'article' + (dim && read ? ' isRead' : '') + (fading ? ' fading' : '')}><div className="articleMain">
    {/* 위계: 분류 배지 줄 → 제목 → 출처·시간 → 중요도·태그 */}
    <div className="cardTop">
      {rank !== undefined && <span className="rank">{rank}</span>}
      <span className={a.source_type === 'press' ? 'pill official' : 'pill'}>{a.category}</span>
      {baseline && isNewArticle(a, baseline) && <span className="new">새</span>}
    </div>
    <h3 className="cardTitle">{isSafeUrl(a.url)
      ? <a className="headline" href={a.url} target="_blank" rel="noopener noreferrer" onClick={() => onRead(a.id)} onAuxClick={e => { if (e.button === 1) onRead(a.id); }}>{a.title}<ExternalLink size={15} aria-hidden="true" /></a>
      : <span className="headline">{a.title} <small>(링크 없음)</small></span>}</h3>
    <div className="meta"><span>{a.source}</span><span className="dot" aria-hidden="true">·</span><time dateTime={a.published_at}>{fmt(a.published_at)}</time></div>
    <div className="bottomMeta"><span>학습 중요도 {'★'.repeat(a.score)}{'☆'.repeat(Math.max(0, 5 - a.score))}</span>{tagList(a).map(t => <span className="tag" key={t}>#{t}</span>)}{read && <span className="read">읽음</span>}{read && onUnread && <button type="button" className="unreadBtn" onClick={() => onUnread(a.id)}>안 읽음으로</button>}</div>
  </div>
    <div className="cardActions">
      {onMarkRead && !read && <button type="button" aria-label="읽음 처리" title="읽음 처리" className="readBtn" onClick={() => onMarkRead(a.id)}><Check size={20} /></button>}
      <button type="button" aria-label={bookmarked ? '북마크 해제' : '북마크 추가'} aria-pressed={bookmarked} className="bookmark" onClick={() => onBookmark(a)}><Bookmark size={20} className={bookmarked ? 'saved' : undefined} aria-hidden="true" /></button>
    </div>
  </article>;
}
