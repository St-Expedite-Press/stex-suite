// Igor single-page app: routing, conversation state, polling, and actions.
// All records live on Igor's server; this component only mirrors them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import * as api from './chat/api';
import { formatFullDate, lastReplyTransport, transportLabel } from './chat/format';
import { HOME_PATH, NEW_PATH, conversationPath, parseRoute, routeKey, type Route } from './chat/route';
import { useIgorRuntime } from './chat/runtime';
import type { Conversation, ConversationSummary, Health, Message } from './chat/types';
import { Dialog } from './components/Dialog';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Thread, type ThreadView } from './components/Thread';

const POLL_MS = 1000;
const HEALTH_MS = 60_000;
const TOAST_MS = 4000;
const NO_MESSAGES: readonly Message[] = [];
const DRAWER_QUERY = '(max-width: 767.98px)';

type Loaded =
  | { status: 'idle' }
  | { status: 'loading'; id: string }
  | { status: 'ready'; conversation: Conversation }
  | { status: 'notfound'; id: string }
  | { status: 'error'; id: string; message: string };

const hasPending = (conversation: Conversation | null) =>
  conversation?.messages.some((message) => message.status === 'pending') ?? false;

export function App() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [summaries, setSummaries] = useState<ConversationSummary[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded>({ status: 'idle' });
  const [reloadToken, setReloadToken] = useState(0);
  const [pollToken, setPollToken] = useState(0);
  const [health, setHealth] = useState<Health | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'about' | 'details' | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const sendingRef = useRef(false);

  const activeId = route.kind === 'conversation' ? route.id : null;
  // Only state that belongs to the routed conversation counts; anything else is stale.
  const loadedId = loaded.status === 'idle' ? null : loaded.status === 'ready' ? loaded.conversation.id : loaded.id;
  const current: Loaded = activeId !== null && loadedId === activeId ? loaded : { status: 'idle' };
  const conversation = current.status === 'ready' ? current.conversation : null;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // ---- notices -------------------------------------------------------------

  const showToast = useCallback((text: string) => setToast({ id: Date.now(), text }), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // ---- routing -------------------------------------------------------------

  const navigate = useCallback((path: string, options: { replace?: boolean } = {}) => {
    if (options.replace) window.history.replaceState(null, '', path);
    else if (window.location.pathname !== path) window.history.pushState(null, '', path);
    setRoute(parseRoute(path));
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ---- data ----------------------------------------------------------------

  const refreshList = useCallback(async () => {
    try {
      const { conversations } = await api.listConversations();
      setSummaries(conversations);
      setListError(null);
    } catch (error) {
      setListError(api.errorMessage(error));
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  /** Apply a server conversation if it is still the one on screen. */
  const applyConversation = useCallback((next: Conversation) => {
    if (activeIdRef.current === next.id) setLoaded({ status: 'ready', conversation: next });
  }, []);

  /** After a 409 the server knows better (another tab acted): catch up, which also resumes polling. */
  const refetch = (id: string) => {
    api.getConversation(id).then(({ conversation: next }) => applyConversation(next), () => undefined);
  };

  // Load the routed conversation (deep links, Back/Forward). Never submits anything.
  const key = routeKey(route);
  useEffect(() => {
    if (route.kind !== 'conversation') {
      setLoaded({ status: 'idle' });
      return;
    }
    const id = route.id;
    if (conversationRef.current?.id === id) return; // already have it (e.g. just created)
    let cancelled = false;
    setLoaded({ status: 'loading', id });
    api.getConversation(id).then(
      ({ conversation: next }) => {
        if (!cancelled) setLoaded({ status: 'ready', conversation: next });
      },
      (error: unknown) => {
        if (cancelled) return;
        if (api.isNotFound(error)) setLoaded({ status: 'notfound', id });
        else setLoaded({ status: 'error', id, message: api.errorMessage(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key, reloadToken]);

  // /igor/ opens the most recently updated active conversation, else the draft view.
  useEffect(() => {
    if (route.kind !== 'home' || summaries === null) return;
    const latest = [...summaries]
      .filter((summary) => !summary.archived)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (latest) navigate(conversationPath(latest.id), { replace: true });
  }, [route, summaries, navigate]);

  // Poll while a reply is pending; refresh the list when it settles.
  const pending = hasPending(conversation);
  useEffect(() => {
    if (!conversation || !pending) return;
    const id = conversation.id;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.getConversation(id).then(
        ({ conversation: next }) => {
          if (cancelled) return;
          applyConversation(next);
          if (!hasPending(next)) void refreshList();
        },
        (error: unknown) => {
          if (cancelled) return;
          if (api.isNotFound(error)) {
            if (activeIdRef.current === id) setLoaded({ status: 'notfound', id });
            void refreshList();
          } else {
            setPollToken((token) => token + 1); // transient failure: try again on the next tick
          }
        },
      );
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [conversation, pending, pollToken, applyConversation, refreshList]);

  // Transport indicator and relative dates.
  useEffect(() => {
    const check = () =>
      api.getHealth().then(
        (result) => setHealth(result),
        () => setHealth({ ok: false, transport: 'unavailable' }),
      );
    void check();
    const timer = window.setInterval(() => {
      void check();
      setNow(Date.now());
    }, HEALTH_MS);
    return () => window.clearInterval(timer);
  }, []);

  // ---- view ----------------------------------------------------------------

  let view: ThreadView;
  if (route.kind === 'new') view = { status: 'draft' };
  else if (route.kind === 'home') {
    const hasActive = summaries?.some((summary) => !summary.archived) ?? false;
    view = summaries === null && !listError ? { status: 'loading' } : hasActive ? { status: 'loading' } : { status: 'draft' };
  } else if (current.status === 'ready') view = { status: 'ready', conversation: current.conversation };
  else if (current.status === 'notfound') view = { status: 'notfound' };
  else if (current.status === 'error') view = { status: 'error', message: current.message };
  else view = { status: 'loading', title: summaries?.find((summary) => summary.id === activeId)?.title };

  const pageTitle =
    view.status === 'ready'
      ? view.conversation.title
      : view.status === 'notfound'
        ? 'Conversation not found'
        : view.status === 'draft'
          ? 'New conversation'
          : view.status === 'loading'
            ? (view.title ?? null)
            : null;

  useEffect(() => {
    document.title = pageTitle ? `${pageTitle} · Igor` : 'Igor';
  }, [pageTitle]);

  // ---- sending (through the assistant-ui composer) -------------------------

  const focusComposer = () => window.requestAnimationFrame(() => inputRef.current?.focus());

  const send = async (text: string): Promise<boolean> => {
    if (sendingRef.current) return false;
    const target = route.kind === 'conversation' ? conversation : null;
    if (route.kind === 'conversation' && !target) return false;
    sendingRef.current = true;
    setSending(true);
    const idempotencyKey = api.newIdempotencyKey(); // once per submission; reused by api.ts on a network retry
    try {
      if (target) {
        const { conversation: next } = await api.sendMessage(target.id, idempotencyKey, text);
        applyConversation(next);
      } else {
        const { conversation: created, route: nextRoute } = await api.createConversation(idempotencyKey, text);
        // Only take over the route if the user is still on the draft; it is in the sidebar either way.
        if (activeIdRef.current === null) {
          const path = nextRoute || conversationPath(created.id);
          activeIdRef.current = created.id;
          conversationRef.current = created;
          window.history.replaceState(null, '', path);
          setRoute(parseRoute(path));
          setLoaded({ status: 'ready', conversation: created });
        }
      }
      void refreshList();
      focusComposer();
      return true;
    } catch (error) {
      showToast(api.isConflict(error) ? 'Igor is still replying. Your message was kept.' : api.errorMessage(error));
      if (api.isConflict(error) && target) refetch(target.id);
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const runtime = useIgorRuntime({
    messages: conversation?.messages ?? NO_MESSAGES,
    isRunning: pending,
    isSendDisabled: sending || view.status === 'loading' || (route.kind === 'conversation' && !conversation),
    onSend: send,
  });

  // ---- conversation actions ------------------------------------------------

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      showToast(api.errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const rename = async (title: string): Promise<boolean> => {
    if (!conversation) return false;
    let saved = false;
    await runAction(async () => {
      const { conversation: next } = await api.updateConversation(conversation.id, { title });
      applyConversation(next);
      saved = true;
      void refreshList();
    });
    return saved;
  };

  const toggleArchive = () => {
    if (!conversation) return;
    const archived = !conversation.archived;
    void runAction(async () => {
      const { conversation: next } = await api.updateConversation(conversation.id, { archived });
      applyConversation(next);
      showToast(archived ? 'Conversation archived' : 'Conversation restored');
      void refreshList();
    });
  };

  const remove = () => {
    if (!conversation) return;
    if (!window.confirm(`Delete “${conversation.title}”? This cannot be undone.`)) return;
    const id = conversation.id;
    void runAction(async () => {
      await api.deleteConversation(id);
      await refreshList();
      if (activeIdRef.current === id) navigate(HOME_PATH, { replace: true });
      showToast('Conversation deleted');
    });
  };

  const retry = async (message: Message) => {
    if (!conversation || retryingId) return;
    setRetryingId(message.id);
    try {
      const { conversation: next } = await api.retryMessage(conversation.id, message.id);
      applyConversation(next);
      void refreshList();
    } catch (error) {
      showToast(api.isConflict(error) ? 'This reply can no longer be retried.' : api.errorMessage(error));
      if (api.isConflict(error)) refetch(conversation.id);
    } finally {
      setRetryingId(null);
    }
  };

  const copy = (message: Message) => {
    if (!navigator.clipboard) {
      showToast('Copying is not available in this browser.');
      return;
    }
    navigator.clipboard.writeText(message.content).then(
      () => showToast('Copied'),
      () => showToast('Could not copy the reply.'),
    );
  };

  // ---- mobile drawer -------------------------------------------------------

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (!sidebarOpen) {
      if (wasOpen.current) toggleRef.current?.focus();
      wasOpen.current = false;
      return;
    }
    wasOpen.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    sidebarRef.current?.querySelector<HTMLElement>('.igor-new')?.focus();
    // Keep keyboard focus inside the open drawer: the thread behind the scrim is inert.
    const main = document.querySelector<HTMLElement>('.igor-main');
    main?.setAttribute('inert', '');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSidebar();
    };
    const query = window.matchMedia(DRAWER_QUERY);
    const onQuery = () => {
      if (!query.matches) closeSidebar();
    };
    document.addEventListener('keydown', onKey);
    query.addEventListener('change', onQuery);
    return () => {
      document.body.style.overflow = previousOverflow;
      main?.removeAttribute('inert');
      document.removeEventListener('keydown', onKey);
      query.removeEventListener('change', onQuery);
    };
  }, [sidebarOpen, closeSidebar]);

  const openConversation = (id: string) => {
    navigate(conversationPath(id));
    closeSidebar();
  };

  const startNew = () => {
    navigate(NEW_PATH);
    closeSidebar();
    focusComposer();
  };

  // ---- render --------------------------------------------------------------

  const lastTransport = conversation ? lastReplyTransport(conversation.messages) : undefined;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="igor-app" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
        <Header
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onAbout={() => setDialog('about')}
          toggleRef={toggleRef}
        />
        <div className="igor-body">
          {sidebarOpen && <div className="igor-scrim" aria-hidden="true" onClick={closeSidebar} />}
          <Sidebar
            summaries={summaries}
            listError={listError}
            activeId={activeId}
            health={health}
            now={now}
            onNew={startNew}
            onOpen={openConversation}
            sidebarRef={sidebarRef}
          />
          <Thread
            view={view}
            busy={busy}
            retryingId={retryingId}
            inputRef={inputRef}
            onRename={rename}
            onToggleArchive={toggleArchive}
            onDelete={remove}
            onDetails={() => setDialog('details')}
            onCopy={copy}
            onRetry={retry}
            onReload={() => setReloadToken((token) => token + 1)}
            onStartNew={startNew}
          />
        </div>

        <Dialog open={dialog === 'about'} title="About Igor" onClose={() => setDialog(null)}>
          <p>Igor is the Pantheon Director, the assistant for your work across STEX Pantheon.</p>
          <p>Replies come through the STEX inference service. Your conversations are kept by Igor on this machine.</p>
          <p>When the inference service uses its fake transport, replies are simulated and labelled “Simulated”.</p>
        </Dialog>

        <Dialog open={dialog === 'details' && conversation !== null} title="Conversation details" onClose={() => setDialog(null)}>
          {conversation && (
            <dl className="igor-details">
              <dt>Created</dt>
              <dd>
                <time dateTime={conversation.createdAt}>{formatFullDate(conversation.createdAt)}</time>
              </dd>
              <dt>Updated</dt>
              <dd>
                <time dateTime={conversation.updatedAt}>{formatFullDate(conversation.updatedAt)}</time>
              </dd>
              <dt>Messages</dt>
              <dd>{conversation.messages.length}</dd>
              <dt>Last reply</dt>
              <dd>{lastTransport ? transportLabel(lastTransport) : 'No reply yet'}</dd>
            </dl>
          )}
        </Dialog>

        {toast && (
          <div className="igor-toast" role="status" key={toast.id}>
            {toast.text}
          </div>
        )}
      </div>
    </AssistantRuntimeProvider>
  );
}
