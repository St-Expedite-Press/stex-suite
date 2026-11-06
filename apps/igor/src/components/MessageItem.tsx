// One transcript entry. Rendered inside ThreadPrimitive.Messages, so the
// assistant-ui message context is available for MessagePrimitive.
// Data comes from the Igor message itself; Hermes payloads never reach here.

import { Fragment, type ComponentPropsWithoutRef } from 'react';
import { MessagePrimitive } from '@assistant-ui/react';
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../chat/types';
import { formatTime } from '../chat/format';
import { CopyIcon, RetryIcon } from './Icons';

const remarkPlugins = [remarkGfm];

// Links open in a new tab. react-markdown never renders raw HTML (no rehype-raw)
// and its default urlTransform empties unsafe URLs; those render as plain text.
// Images become links: a reply must not make the browser fetch a remote URL
// (a tracking or exfiltration channel) without the user choosing to.
const markdownComponents = {
  img: ({ src, alt }: ComponentPropsWithoutRef<'img'> & { node?: unknown }) =>
    typeof src === 'string' && src ? (
      <a href={src} target="_blank" rel="noopener noreferrer">
        {alt || 'Image'}
      </a>
    ) : (
      <>{alt}</>
    ),
  a: ({ node: _node, href, children, ...props }: ComponentPropsWithoutRef<'a'> & { node?: unknown }) =>
    href ? (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
};

function AssistantMarkdown() {
  return (
    <MarkdownTextPrimitive
      className="igor-message__content igor-prose"
      remarkPlugins={remarkPlugins}
      components={markdownComponents}
      smooth={false}
    />
  );
}

/** User text as typed: no Markdown, line breaks kept. */
function PlainText({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  return (
    <>
      {lines.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

type MessageItemProps = {
  message: Message;
  isLatest: boolean;
  retrying: boolean;
  onCopy: (message: Message) => void;
  onRetry: (message: Message) => void;
};

export function MessageItem({ message, isLatest, retrying, onCopy, onRetry }: MessageItemProps) {
  const isUser = message.role === 'user';
  const role = isUser ? 'user' : 'assistant';
  const isComplete = message.status === 'complete';
  const canRetry = !isUser && message.status === 'failed' && isLatest;

  return (
    <MessagePrimitive.Root asChild>
      <li className={`igor-message igor-message--${role}`} data-status={message.status}>
        <span className={`igor-avatar igor-avatar--${role}`} aria-hidden="true">
          {isUser ? 'U' : 'I'}
        </span>
        <div className="igor-message__body">
          <div className="igor-message__meta">
            <span className="igor-message__author">{isUser ? 'You' : 'Igor'}</span>
            <time className="igor-message__time" dateTime={message.createdAt}>
              {formatTime(message.createdAt)}
            </time>
            {!isUser && message.transport === 'fake' && <span className="igor-message__badge">Simulated</span>}
          </div>

          {isUser ? (
            <div className="igor-message__content igor-prose">
              <PlainText text={message.content} />
            </div>
          ) : isComplete && message.content ? (
            <MessagePrimitive.Parts components={{ Text: AssistantMarkdown }} />
          ) : null}

          {message.status === 'pending' && (
            <p className="igor-message__pending">
              Igor is replying
              <span className="igor-dots" aria-hidden="true" />
            </p>
          )}

          {message.status === 'failed' && (
            <div className="igor-message__error" role="alert">
              {message.error?.message ?? 'The reply failed.'}
            </div>
          )}

          {!isUser && (isComplete || canRetry) && (
            <div className="igor-message__actions">
              {isComplete && (
                <button type="button" className="igor-icon-button" aria-label="Copy reply" onClick={() => onCopy(message)}>
                  <CopyIcon />
                </button>
              )}
              {canRetry && (
                <button
                  type="button"
                  className="igor-icon-button"
                  aria-label="Retry"
                  disabled={retrying}
                  onClick={() => onRetry(message)}
                >
                  <RetryIcon />
                </button>
              )}
            </div>
          )}
        </div>
      </li>
    </MessagePrimitive.Root>
  );
}
