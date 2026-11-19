// Native proof viewer: spreads or single pages from the compiled PDF, laid out by
// the compiler page map. Returns null when PDF.js cannot load so the caller can
// fall back to the browser's own PDF viewer.
import { appUrl } from './base-path.js';

const POINTS_TO_CSS = 96 / 72;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const clampZoom = (value) => Math.min(4, Math.max(0.25, value));

export async function createProofViewer(root, { describePage, onSelectPage }) {
  let pdfjs;
  try {
    pdfjs = await import(appUrl('/vendor/pdfjs/pdf.min.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = appUrl('/vendor/pdfjs/pdf.worker.min.mjs');
  } catch { return null; }

  const button = (text, title) => Object.assign(document.createElement('button'), { type: 'button', className: 'quiet-button', textContent: text, title });
  const toolbar = document.createElement('div'); toolbar.className = 'viewer-toolbar';
  const previous = button('◀', 'Previous spread (←)'); const next = button('▶', 'Next spread (→)');
  const position = Object.assign(document.createElement('span'), { className: 'viewer-position' });
  const mode = document.createElement('select'); mode.setAttribute('aria-label', 'Page layout');
  mode.append(new Option('Spreads', 'spread'), new Option('Single pages', 'single'));
  const zoomOut = button('−', 'Zoom out (−)'); const zoomIn = button('+', 'Zoom in (+)');
  const zoom = document.createElement('select'); zoom.setAttribute('aria-label', 'Magnification');
  const custom = new Option('', 'custom'); custom.hidden = true;
  zoom.append(new Option('Fit width', 'fit-width'), new Option('Fit page', 'fit-page'), ...[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => new Option(value === 1 ? 'Actual size' : `${value * 100}%`, String(value))), custom);
  const zoomGroup = Object.assign(document.createElement('span'), { className: 'viewer-zoom' }); zoomGroup.append(zoomOut, zoom, zoomIn);
  toolbar.append(previous, position, next, mode, zoomGroup);
  const scroller = Object.assign(document.createElement('div'), { className: 'viewer-pages', tabIndex: 0 });
  scroller.setAttribute('aria-label', 'Proof pages');
  root.replaceChildren(toolbar, scroller);

  let documentTask = null; let pdf = null; let map = null; let rows = []; let slots = new Map(); let pageSize = null; let observer = null; let highlighted = [0, 0];
  // 'fit-width', 'fit-page', or a magnification where 1 is the printed size.
  let zoomSetting = 'fit-width'; let renderGeneration = 0;
  // A proof of one section starts mid-book; captions, sides and the readout use book page numbers.
  const bookPageOf = (number) => describePage(number).bookPage ?? number;

  // A bound book opens on a lone recto; later spreads are verso + recto. The
  // compiler map supplies them when it describes this exact PDF.
  function layout() {
    if (mode.value === 'single') return Array.from({ length: pdf.numPages }, (_, index) => [index + 1]);
    if (map?.spreads?.length && map.pagination?.physicalPageCount === pdf.numPages) return map.spreads.map((spread) => spread.pages);
    const spreads = [[1]];
    for (let verso = 2; verso <= pdf.numPages; verso += 2) spreads.push(verso + 1 <= pdf.numPages ? [verso, verso + 1] : [verso]);
    return spreads;
  }

  // CSS pixels per PDF point.
  function scale() {
    if (typeof zoomSetting === 'number') return zoomSetting * POINTS_TO_CSS;
    const columns = mode.value === 'spread' ? 2 : 1;
    const widthFit = (scroller.clientWidth - 48 - (columns - 1) * 4) / columns / pageSize.width;
    const pageFit = (scroller.clientHeight - 32 - 22) / pageSize.height;
    return Math.max(0.1, zoomSetting === 'fit-page' ? Math.min(widthFit, pageFit) : widthFit);
  }
  const magnification = () => scale() / POINTS_TO_CSS;

  function showZoom() {
    const preset = typeof zoomSetting === 'number' ? [...zoom.options].find((option) => Number(option.value) === zoomSetting) : null;
    custom.hidden = typeof zoomSetting !== 'number' || Boolean(preset);
    custom.textContent = `${Math.round(magnification() * 100)}%`;
    zoom.value = typeof zoomSetting === 'number' ? (preset ? preset.value : 'custom') : zoomSetting;
  }

  async function renderPage(slot) {
    if (slot.dataset.rendered) return;
    const generation = String(renderGeneration); slot.dataset.rendered = generation;
    const page = await pdf.getPage(Number(slot.dataset.page));
    const ratio = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale() * ratio });
    const canvas = document.createElement('canvas'); canvas.width = Math.floor(viewport.width); canvas.height = Math.floor(viewport.height);
    try {
      await page.render({ canvas, viewport }).promise;
      // The page may have scrolled away or been re-laid-out while it rendered.
      if (slot.dataset.rendered === generation && slot.isConnected) slot.querySelector('.proof-sheet').replaceChildren(canvas);
    } catch { if (slot.dataset.rendered === generation) slot.querySelector('.proof-sheet').textContent = 'This page could not be rendered.'; }
  }
  // Far-off pages give their canvas back so long books stay light.
  function releasePage(slot) { if (!slot.dataset.rendered) return; delete slot.dataset.rendered; slot.querySelector('.proof-sheet').replaceChildren(); }

  function build() {
    observer?.disconnect(); slots = new Map(); renderGeneration += 1;
    const pageScale = scale(); const width = pageSize.width * pageScale; const height = pageSize.height * pageScale;
    observer = new IntersectionObserver((entries) => entries.forEach((entry) => (entry.isIntersecting ? renderPage(entry.target) : releasePage(entry.target))), { root: scroller, rootMargin: '1200px 600px' });
    rows = layout(); scroller.style.setProperty('--proof-page-width', `${width}px`);
    scroller.replaceChildren(...rows.map((pages) => {
      const row = document.createElement('div'); row.className = `proof-row ${mode.value}`;
      // Keep a lone recto on the right and a lone verso on the left of a spread.
      if (mode.value === 'spread' && pages.length === 1 && bookPageOf(pages[0]) % 2 === 1) row.append(Object.assign(document.createElement('div'), { className: 'proof-gap' }));
      for (const number of pages) {
        const slot = document.createElement('figure'); slot.className = 'proof-page'; slot.dataset.page = String(number); slot.style.width = `${width}px`;
        const sheet = document.createElement('div'); sheet.className = 'proof-sheet'; sheet.style.width = `${width}px`; sheet.style.height = `${height}px`;
        const description = describePage(number);
        const caption = document.createElement('figcaption'); const bookPage = description.bookPage ?? number;
        caption.textContent = `${bookPage} · ${bookPage % 2 ? 'recto' : 'verso'}${description.label ? ` · ${description.label}` : ''}`;
        slot.classList.toggle('blank', Boolean(description.blank));
        if (description.nodeId) {
          slot.tabIndex = 0; slot.title = 'Open this page’s manuscript piece';
          slot.addEventListener('click', () => onSelectPage(number, description.nodeId));
          slot.addEventListener('keydown', (event) => { if (event.key === 'Enter') onSelectPage(number, description.nodeId); });
        }
        slot.append(sheet, caption); slots.set(number, slot); observer.observe(slot);
        row.append(slot);
      }
      return row;
    }));
    showZoom(); applyHighlight(); updatePosition();
  }

  function visibleRow() {
    const top = scroller.getBoundingClientRect().top;
    const index = [...scroller.children].findIndex((row) => row.getBoundingClientRect().bottom > top + 24);
    return Math.max(0, index);
  }
  const visiblePage = () => (rows[visibleRow()] || [1])[0];
  function updatePosition() {
    const pages = rows[visibleRow()] || [];
    const offset = pdf ? bookPageOf(1) - 1 : 0;
    const shown = pages.length > 1 ? `pp. ${bookPageOf(pages[0])}–${bookPageOf(pages.at(-1))}` : `p. ${pages.length ? bookPageOf(pages[0]) : '—'}`;
    position.textContent = pdf ? (offset ? `${shown} · ${pdf.numPages}-page proof` : `${shown} of ${pdf.numPages}`) : '';
  }
  // Scroll only the viewer; scrollIntoView would also move the Studio window.
  function scrollTo(element) { if (element) scroller.scrollTop += element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12; }
  function step(direction) { scrollTo(scroller.children[Math.min(rows.length - 1, Math.max(0, visibleRow() + direction))]); }
  function applyHighlight() { for (const [number, slot] of slots) slot.classList.toggle('selected', number >= highlighted[0] && number <= highlighted[1]); }
  function showPage(number) { scrollTo(slots.get(number)?.parentElement); updatePosition(); }

  // Every relayout keeps the page that was at the top of the view.
  function relayout() { if (!pdf) return; const page = visiblePage(); build(); showPage(page); }
  function setZoom(value) { zoomSetting = typeof value === 'number' ? clampZoom(value) : value; relayout(); }
  function stepZoom(direction) {
    const current = magnification();
    const target = direction > 0 ? ZOOM_STEPS.find((value) => value > current + 0.01) : [...ZOOM_STEPS].reverse().find((value) => value < current - 0.01);
    setZoom(target ?? (direction > 0 ? 4 : 0.25));
  }

  let resizeTimer = null;
  new ResizeObserver(() => { if (!pdf || typeof zoomSetting === 'number') return; clearTimeout(resizeTimer); resizeTimer = setTimeout(relayout, 150); }).observe(scroller);
  mode.addEventListener('change', relayout);
  zoom.addEventListener('change', () => { if (zoom.value !== 'custom') setZoom(zoom.value.startsWith('fit') ? zoom.value : Number(zoom.value)); });
  zoomIn.addEventListener('click', () => stepZoom(1)); zoomOut.addEventListener('click', () => stepZoom(-1));
  previous.addEventListener('click', () => step(-1)); next.addEventListener('click', () => step(1));
  scroller.addEventListener('scroll', updatePosition, { passive: true });
  // Ctrl/⌘ + wheel and trackpad pinch zoom around the current page; the redraw waits for the gesture to settle.
  let wheelZoom = null; let wheelTimer = null;
  scroller.addEventListener('wheel', (event) => {
    if (!pdf || !(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    wheelZoom = clampZoom((wheelZoom ?? magnification()) * Math.exp(-event.deltaY * 0.0025));
    custom.hidden = false; custom.textContent = `${Math.round(wheelZoom * 100)}%`; zoom.value = 'custom';
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { const value = wheelZoom; wheelZoom = null; setZoom(Math.round(value * 100) / 100); }, 140);
  }, { passive: false });
  scroller.addEventListener('keydown', (event) => {
    const direction = { ArrowRight: 1, PageDown: 1, ArrowLeft: -1, PageUp: -1 }[event.key];
    if (direction) { event.preventDefault(); step(direction); return; }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); stepZoom(1); }
    else if (event.key === '-') { event.preventDefault(); stepZoom(-1); }
    else if (event.key === '0') { event.preventDefault(); setZoom('fit-width'); }
  });

  return {
    // Loading a newer proof keeps the reader on the same page number.
    async load(url, pageMap) {
      const keep = pdf ? visiblePage() : null;
      const task = pdfjs.getDocument({ url, isEvalSupported: false });
      const prior = documentTask; documentTask = task;
      await prior?.destroy();
      const loaded = await task.promise;
      if (documentTask !== task) return false;
      pdf = loaded; map = pageMap;
      const viewport = (await pdf.getPage(1)).getViewport({ scale: 1 }); pageSize = { width: viewport.width, height: viewport.height };
      build(); if (keep) showPage(Math.min(keep, pdf.numPages));
      return true;
    },
    showPage,
    highlight(first, last = first) { highlighted = [first || 0, last || 0]; applyHighlight(); },
  };
}
