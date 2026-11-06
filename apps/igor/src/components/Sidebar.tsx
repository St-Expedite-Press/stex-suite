import { useEffect, useRef, type MouseEvent, type RefObject } from 'react';
import type { ConversationSummary, Health } from '../chat/types';
import { formatRelative, transportLabel } from '../chat/format';
import { conversationPath, isPlainClick } from '../chat/route';
import { ChatIcon, ChevronIcon, PlusIcon } from './Icons';

type SidebarProps = {
  summaries: ConversationSummary[] | null;
  listError: string | null;
  activeId: string | null;
  health: Health | null;
  now: number;
  onNew: () => void;
  onOpen: (id: string) => void;
  sidebarRef: RefObject<HTMLElement | null>;
};

function ConversationList({ items, activeId, now, onOpen }: {
  items: ConversationSummary[];
  activeId: string | null;
  now: number;
  onOpen: (id: string) => void;
}) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    onOpen(id);
  };
  return (
    <ul className="igor-conversations">
      {items.map((item) => (
        <li key={item.id}>
          <a
            className="igor-conversation"
            href={conversationPath(item.id)}
            aria-current={item.id === activeId ? 'page' : undefined}
            onClick={(event) => handleClick(event, item.id)}
          >
            <ChatIcon />
            <span className="igor-conversation__text">
              <span className="igor-conversation__title">{item.title}</span>
              <time className="igor-conversation__date" dateTime={item.updatedAt}>
                {formatRelative(item.updatedAt, now)}
              </time>
              {item.state === 'pending' && <span className="igor-conversation__state">Replying…</span>}
              {item.state === 'failed' && <span className="igor-conversation__state">Failed</span>}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function Sidebar({ summaries, listError, activeId, health, now, onNew, onOpen, sidebarRef }: SidebarProps) {
  const sorted = [...(summaries ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const active = sorted.filter((item) => !item.archived);
  const archived = sorted.filter((item) => item.archived);
  const archiveRef = useRef<HTMLDetailsElement>(null);
  const activeIsArchived = archived.some((item) => item.id === activeId);

  // Reveal the archive when the open conversation lives in it.
  useEffect(() => {
    if (activeIsArchived && archiveRef.current) archiveRef.current.open = true;
  }, [activeIsArchived]);

  return (
    <aside id="igor-sidebar" className="igor-sidebar" ref={sidebarRef}>
      <button type="button" className="igor-new" onClick={onNew}>
        <PlusIcon />
        <span>New conversation</span>
      </button>
      <nav className="igor-nav" aria-label="Conversations">
        <h2 className="igor-section-label">Conversations</h2>
        {active.length > 0 && <ConversationList items={active} activeId={activeId} now={now} onOpen={onOpen} />}
        {summaries !== null && active.length === 0 && (
          <p className="igor-empty-note">{archived.length > 0 ? 'No active conversations.' : 'No conversations yet.'}</p>
        )}
        {summaries === null && listError && <p className="igor-empty-note">{listError}</p>}
        {archived.length > 0 && (
          <details className="igor-archive" ref={archiveRef}>
            <summary className="igor-section-label">
              Archive ({archived.length})
              <ChevronIcon />
            </summary>
            <ConversationList items={archived} activeId={activeId} now={now} onOpen={onOpen} />
          </details>
        )}
      </nav>
      <div className="igor-sidebar__footer">
        {health && (
          <p className="igor-transport" data-transport={health.transport}>
            {transportLabel(health.transport)}
          </p>
        )}
      </div>
    </aside>
  );
}
