// Message composer on assistant-ui's ComposerPrimitive. The primitive input
// auto-grows, submits on Enter, keeps Shift+Enter for new lines, and ignores
// Enter during IME composition. Submission runs once, through the form.

import type { KeyboardEvent, RefObject } from 'react';
import { ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { SendIcon } from './Icons';

type ComposerProps = {
  inputRef: RefObject<HTMLTextAreaElement | null>;
};

const isComposing = (event: KeyboardEvent<HTMLTextAreaElement>) =>
  event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;

export function Composer({ inputRef }: ComposerProps) {
  const canSend = useAuiState((state) => state.composer.canSend && !state.thread.isRunning);

  // While a reply is pending the primitive ignores Enter; keep it from inserting a newline instead.
  const blockEnterWhileBusy = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isComposing(event) && !canSend) event.preventDefault();
  };

  return (
    <ComposerPrimitive.Root className="igor-composer">
      <label className="stex-visually-hidden" htmlFor="igor-composer-input">
        Message Igor
      </label>
      <ComposerPrimitive.Input
        ref={inputRef}
        id="igor-composer-input"
        className="igor-composer__input"
        placeholder="Message Igor…"
        rows={1}
        maxRows={10}
        maxLength={6000}
        submitMode="enter"
        cancelOnEscape={false}
        addAttachmentOnPaste={false}
        onKeyDown={blockEnterWhileBusy}
      />
      <div className="igor-composer__bar">
        <span className="igor-composer__hint">Enter to send · Shift+Enter for a new line</span>
        <button type="submit" className="igor-send" aria-label="Send" disabled={!canSend}>
          <SendIcon />
        </button>
      </div>
    </ComposerPrimitive.Root>
  );
}
