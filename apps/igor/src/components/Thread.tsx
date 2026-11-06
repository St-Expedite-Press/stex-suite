// The open conversation: title and actions, transcript, composer.

import { Fragment, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { ThreadPrimitive } from '@assistant-ui/react';
import type { Conversation, Message } from '../chat/types';
import { NEW_PATH, isPlainClick } from '../chat/route';
import { ArchiveIcon, DetailsIcon, RenameIcon, TrashIcon } from './Icons';
import { Composer } from './Composer';
import { MessageItem } from './MessageItem';

export type ThreadView =
  | { status: 'draft' }
  | { status: 'loading'; title?: string }
  | { status: 'ready'; conversation: Conversation }
  | { status: 'notfound' }
  | { status: 'error'; message: string };

type ThreadProps = {
  view: ThreadView;
  busy: boolean;
  retryingId: string | null;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  onRename: (title: string) => Promise<boolean>;
  onToggleArchive: () => void;
  onDelete: () => void;
  onDetails: () => void;
  onCopy: (message: Message) => void;
  onRetry: (message: Message) => void;
  onReload: () => void;
  onStartNew: () => void;
};

function titleOf(view: ThreadView): string {
  switch (view.status) {
    case 'ready':
      return view.conversation.title;
    case 'loading':
      return view.title ?? 'Loading conversation…';
    case 'notfound':
      return 'Conversation not found';
    case 'error':
      return 'Conversation unavailable';
    default:
      return 'New conversation';
  }
}

function RenameForm({ initial, onSave, onCancel }: { initial: string; onSave: (title: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave(value);
  };
  const keyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return (
    <form className="igor-rename" onSubmit={submit}>
      <label className="stex-visually-hidden" htmlFor="igor-rename-input">
        Conversation title
      </label>
      <input
        ref={inputRef}
        id="igor-rename-input"
        className="igor-rename__input"
        value={value}
        maxLength={120}
        required
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={keyDown}
      />
      <button type="submit" className="igor-action">
        <span>Save</span>
      </button>
    </form>
  );
}

export function Thread(props: ThreadProps) {
  const { view, busy, retryingId, inputRef } = props;
  const [renaming, setRenaming] = useState(false);
  const conversation = view.status === 'ready' ? view.conversation : null;
  const conversationId = conversation?.id ?? null;
  const renameButtonRef = useRef<HTMLButtonElement>(null);

  // Leaving a conversation abandons an unsaved rename.
  useEffect(() => setRenaming(false), [conversationId]);

  const finishRename = (restoreFocus: boolean) => {
    setRenaming(false);
    if (restoreFocus) requestAnimationFrame(() => renameButtonRef.current?.focus());
  };

  const saveRename = async (value: string) => {
    const title = value.trim();
    if (!conversation || !title || title === conversation.title) {
      finishRename(true);
      return;
    }
    if (await props.onRename(title)) finishRename(true);
  };

  const startNew = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isPlainClick(event)) return;
    event.preventDefault();
    props.onStartNew();
  };

  const messages = conversation?.messages ?? [];
  const byId = new Map(messages.map((message) => [message.id, message]));
  const latestId = messages.at(-1)?.id;
  const showComposer = view.status === 'draft' || view.status === 'ready' || view.status === 'loading';

  const actions = conversation
    ? [
        <button key="rename" ref={renameButtonRef} type="button" className="igor-action" disabled={busy} onClick={() => setRenaming(true)}>
          <RenameIcon />
          <span>Rename</span>
        </button>,
        <button key="archive" type="button" className="igor-action" disabled={busy} onClick={props.onToggleArchive}>
          <ArchiveIcon />
          <span>{conversation.archived ? 'Unarchive' : 'Archive'}</span>
        </button>,
        <button key="delete" type="button" className="igor-action" disabled={busy} onClick={props.onDelete}>
          <TrashIcon />
          <span>Delete</span>
        </button>,
      ]
    : [];

  return (
    <ThreadPrimitive.Root asChild>
      <main className="igor-main" id="main">
        <div className="igor-thread-header">
          {renaming && conversation ? (
            <RenameForm initial={conversation.title} onSave={saveRename} onCancel={() => finishRename(true)} />
          ) : (
            <h1 className="igor-thread-title">{titleOf(view)}</h1>
          )}
          {conversation && (
            <div className="igor-thread-actions">
              {actions.map((action, index) => (
                <Fragment key={action.key}>
                  {index > 0 && <span className="igor-action-divider" aria-hidden="true" />}
                  {action}
                </Fragment>
              ))}
              <button type="button" className="igor-icon-button" aria-label="Conversation details" onClick={props.onDetails}>
                <DetailsIcon />
              </button>
            </div>
          )}
        </div>

        <ThreadPrimitive.Viewport className="igor-transcript" autoScroll scrollToBottomOnInitialize scrollToBottomOnThreadSwitch>
          {view.status === 'draft' && <p className="igor-thread-empty">Ask Igor anything about your Pantheon work.</p>}
          {view.status === 'ready' && messages.length === 0 && (
            <p className="igor-thread-empty">Ask Igor anything about your Pantheon work.</p>
          )}
          {view.status === 'notfound' && (
            <p className="igor-thread-empty">
              This conversation does not exist or was deleted.{' '}
              <a href={NEW_PATH} onClick={startNew}>
                Start a new conversation
              </a>
            </p>
          )}
          {view.status === 'error' && (
            <p className="igor-thread-empty" role="alert">
              {view.message}{' '}
              <button type="button" className="igor-action" onClick={props.onReload}>
                <span>Try again</span>
              </button>
            </p>
          )}
          {view.status === 'ready' && messages.length > 0 && (
            <ol className="igor-messages">
              <ThreadPrimitive.Messages>
                {({ message }) => {
                  const igorMessage = byId.get(message.id);
                  return igorMessage ? (
                    <MessageItem
                      message={igorMessage}
                      isLatest={igorMessage.id === latestId}
                      retrying={retryingId === igorMessage.id}
                      onCopy={props.onCopy}
                      onRetry={props.onRetry}
                    />
                  ) : null;
                }}
              </ThreadPrimitive.Messages>
            </ol>
          )}
        </ThreadPrimitive.Viewport>

        {showComposer && <Composer inputRef={inputRef} />}
      </main>
    </ThreadPrimitive.Root>
  );
}
