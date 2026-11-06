// assistant-ui adapter: Igor's server owns every conversation record, so the
// runtime is an external store over Igor messages. Nothing here persists,
// streams, or talks to Hermes; sending goes through the caller's onSend.

import { useRef } from 'react';
import {
  useExternalStoreRuntime,
  type AssistantRuntime,
  type ExternalStoreAdapter,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { Message } from './types';

type AppendMessage = Parameters<ExternalStoreAdapter<Message>['onNew']>[0];

function statusOf(message: Message): ThreadMessageLike['status'] {
  if (message.status === 'pending') return { type: 'running' };
  if (message.status === 'failed') {
    return { type: 'incomplete', reason: 'error', error: message.error?.message ?? 'The reply failed.' };
  }
  return { type: 'complete', reason: 'stop' };
}

/** Igor message -> assistant-ui message. Ids are the stable Igor ids. */
export function toThreadMessage(message: Message): ThreadMessageLike {
  return {
    id: message.id,
    role: message.role,
    content: message.content ? [{ type: 'text', text: message.content }] : [],
    createdAt: new Date(message.createdAt),
    ...(message.role === 'assistant' ? { status: statusOf(message) } : {}),
  };
}

const textOf = (append: AppendMessage) =>
  append.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n\n');

export type IgorRuntimeOptions = {
  messages: readonly Message[];
  /** Any Igor message is pending. */
  isRunning: boolean;
  /** A send is in flight, or there is no conversation to send to. */
  isSendDisabled: boolean;
  /** Sends one user message. Resolves false when it was not accepted (the draft is then restored). */
  onSend: (text: string) => Promise<boolean>;
};

export function useIgorRuntime(options: IgorRuntimeOptions): AssistantRuntime {
  const onSendRef = useRef(options.onSend);
  onSendRef.current = options.onSend;
  const runtimeRef = useRef<AssistantRuntime | null>(null);

  const runtime = useExternalStoreRuntime<Message>({
    messages: options.messages,
    isRunning: options.isRunning,
    isSendDisabled: options.isSendDisabled,
    convertMessage: toThreadMessage,
    onNew: async (append) => {
      const text = textOf(append);
      if (!text.trim()) return;
      const accepted = await onSendRef.current(text);
      if (accepted) return;
      // The composer clears itself on send; give the draft back unless the user already typed again.
      const composer = runtimeRef.current?.thread.composer;
      if (composer && composer.getState().text === '') composer.setText(text);
    },
  });
  runtimeRef.current = runtime;
  return runtime;
}
