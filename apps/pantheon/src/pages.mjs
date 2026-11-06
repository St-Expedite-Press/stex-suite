// Editorial pages behind the splash: one shell (masthead, tabs) around each
// page's content. Project data is loaded in the browser from each studio's
// stex.projects.summary.v1 endpoint (protocol/projects); Pantheon stores none.

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

export const tabs = Object.freeze([
  { id: 'home', label: 'Home', route: '/home/' },
  { id: 'projects', label: 'Projects', route: '/projects/' },
  { id: 'studios', label: 'Studios', route: '/studios/' },
  { id: 'graph', label: 'Graph', route: '/graph/' },
  { id: 'activity', label: 'Activity', route: '/activity/' },
]);

// Display identities; the registry (protocol/applications) stays ASCII and owns state.
export const studios = Object.freeze([
  { id: 'frige', name: 'Frige', descriptor: 'Publishing and typography', emblem: 'frige-emblem', width: 194 },
  { id: 'seaxneat', name: 'Seaxneat', descriptor: 'Software development', emblem: 'seaxneat-emblem', width: 138 },
  { id: 'eostre', name: 'Ēostre', descriptor: 'Image and print production', emblem: 'eostre-emblem', width: 199 },
  { id: 'woden', name: 'Woden', descriptor: 'Narrative and story systems', emblem: 'woden-emblem', width: 171 },
]);

const media = '/media/masthead/pantheon-masthead';
// Phones (< 900px) get a 4:1 window of the art; wider screens get the 6.7:1 stripe.
const masthead = `<header class="masthead">
  <div class="masthead-art" aria-hidden="true">
    <picture>
      <source media="(max-width: 899px)" srcset="${media}-still-960w.webp">
      <img class="masthead-still" alt="" width="1920" height="288" fetchpriority="high" decoding="async" src="${media}-still-1920w.webp" srcset="${media}-still-1280w.webp 1280w, ${media}-still-1920w.webp 1920w" sizes="100vw">
    </picture>
    <video class="masthead-motion" muted loop playsinline preload="none" disablepictureinpicture disableremoteplayback tabindex="-1">
      <!-- Codec strings are the encoded profile and level (ffprobe), not guesses. -->
      <source media="(max-width: 899px)" src="${media}-loop-960w.webm" type='video/webm; codecs="av01.0.01M.10"'>
      <source media="(max-width: 899px)" src="${media}-loop-960w.mp4" type='video/mp4; codecs="avc1.64001E"'>
      <source media="(max-width: 1279px)" src="${media}-loop-1280w.webm" type='video/webm; codecs="av01.0.01M.10"'>
      <source media="(max-width: 1279px)" src="${media}-loop-1280w.mp4" type='video/mp4; codecs="avc1.64001E"'>
      <source src="${media}-loop-1920w.webm" type='video/webm; codecs="av01.0.04M.10"'>
      <source src="${media}-loop-1920w.mp4" type='video/mp4; codecs="avc1.64001F"'>
    </video>
  </div>
  <a class="masthead-brand" href="/home/">
    <span class="stex-emblem" aria-hidden="true"></span>
    <span class="stex-wordmark masthead-wordmark"><span class="stex-wordmark__org"><abbr title="St. Expedite Press">STEX</abbr></span> <span class="stex-wordmark__name">Pantheon</span></span>
  </a>
</header>`;

function navigation(active) {
  const items = tabs.map((tab) => `<li><a href="${tab.route}"${tab.id === active ? ' aria-current="page"' : ''}>${tab.label}</a></li>`).join('');
  return `<nav class="tabs" aria-label="Pantheon"><ul>${items}</ul><button class="motion-toggle" type="button" hidden>Pause motion</button></nav>`;
}

export function shell({ active, title, body, scripts = [], app = 'pantheon' }) {
  const pageScripts = ['/shell.js', ...scripts].map((src) => `<script type="module" src="${src}"></script>`).join('');
  return `<!doctype html>
<html lang="en" data-stex-app="${escape(app)}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(title)} · STEX Pantheon</title>
  <meta name="theme-color" content="#0B1518">
  <link rel="icon" href="/design-system/brand/pantheon-favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="/design-system/src/stex.css">
  <link rel="stylesheet" href="/shell.css">
  ${pageScripts}
</head>
<body class="shell">
  <a class="skip-link" href="#main">Skip to content</a>
  ${masthead}
  ${navigation(active)}
  <main class="page" id="main">
${body}
  </main>
</body>
</html>`;
}

const emblemImage = (studio) => `<img class="studio-emblem" alt="" width="${studio.width}" height="64" loading="lazy" src="/media/studios/${studio.emblem}-${studio.width}w.webp" srcset="/media/studios/${studio.emblem}-${studio.width}w.webp 1x, /media/studios/${studio.emblem}-${studio.width * 2}w.webp 2x">`;

// Studio entries carry their real registry state. Project counts are filled in
// by projects.js from the studios' summaries.
function studioList(applications, { counts = false } = {}) {
  const entries = studios.map((studio) => {
    const application = applications.find((entry) => entry.id === studio.id);
    const deferred = application?.state !== 'active';
    return `<li data-stex-app="${studio.id}"><a class="studio-card" href="/${studio.id}/">
      ${emblemImage(studio)}
      <span class="studio-name">${escape(studio.name)}</span>
      <span class="studio-descriptor">${escape(studio.descriptor)}</span>
      <span class="studio-state">${deferred ? 'Deferred' : 'Open'}${counts && !deferred ? ` · <span data-project-count="${studio.id}">counting projects</span>` : ''}</span>
    </a></li>`;
  }).join('\n');
  return `<ul class="studio-cards">${entries}</ul>`;
}

const noscript = '<noscript><p class="stex-meta">Project lists need JavaScript; the studios above still open.</p></noscript>';

export function homePage(applications) {
  return shell({ active: 'home', title: 'Home', scripts: ['/projects.js', '/igor.js'], body: `
    <h1 class="stex-visually-hidden">Pantheon home</h1>
    <div class="home-lead">
      <section class="continue" aria-labelledby="continue-title" data-projects="continue">
        <p class="eyebrow" id="continue-title">Continue working</p>
        <p class="stex-meta" data-projects-status>Loading projects…</p>
        ${noscript}
      </section>
      <section class="igor" aria-labelledby="igor-title">
        <div class="igor-head"><span class="igor-emblem" aria-hidden="true"></span><h2 class="igor-name" id="igor-title">Igor</h2></div>
        <form class="igor-form" novalidate>
          <input class="igor-input" id="igor-input" name="message" type="text" maxlength="6000" autocomplete="off" placeholder="Ask Igor…" aria-labelledby="igor-title" aria-describedby="igor-note" required disabled>
          <button class="stex-button stex-button--primary igor-send" type="submit" aria-label="Send to Igor" disabled><span aria-hidden="true">→</span></button>
        </form>
        <p class="stex-meta igor-note" id="igor-note">Your message opens a new conversation in Igor.</p>
        <ol class="igor-log" aria-live="polite"></ol>
        <a class="section-link" href="/igor/">All conversations</a>
      </section>
    </div>
    <section aria-labelledby="studios-title">
      <h2 class="section-title" id="studios-title">Studios</h2>
      ${studioList(applications)}
    </section>
    <section aria-labelledby="recent-title">
      <div class="section-head"><h2 class="section-title" id="recent-title">Recent projects</h2><a class="section-link" href="/projects/">View all <span aria-hidden="true">→</span></a></div>
      <div data-projects="recent" data-limit="5"><p class="stex-meta" data-projects-status>Loading projects…</p>${noscript}</div>
    </section>` });
}

export function projectsPage() {
  return shell({ active: 'projects', title: 'Projects', scripts: ['/projects.js'], body: `
    <h1 class="page-title">Projects</h1>
    <p class="page-lede">Every project in the active studios, most recently changed first.</p>
    <div data-projects="all"><p class="stex-meta" data-projects-status>Loading projects…</p>${noscript}</div>` });
}

export function studiosPage(applications) {
  return shell({ active: 'studios', title: 'Studios', scripts: ['/projects.js'], body: `
    <h1 class="page-title">Studios</h1>
    <p class="page-lede">Each studio owns its projects and tools. Ēostre and Woden are registered but not built yet.</p>
    ${studioList(applications, { counts: true })}` });
}

export function unbuiltPage(id) {
  const copy = {
    graph: ['Graph', 'The User Graph view is not built yet. The optional, read-only User Graph adapter exists in services/knowledge; a browsing view arrives with its own milestone.'],
    activity: ['Activity', 'An activity history is not built yet. Pantheon shows only real project state, so this page stays empty until the studios publish real events.'],
  }[id];
  return shell({ active: id, title: copy[0], body: `
    <h1 class="page-title">${copy[0]}</h1>
    <p class="page-lede">${copy[1]}</p>
    <p><a class="section-link" href="/home/">Back to home</a></p>` });
}

export function deferredStudioPage(application, description) {
  const studio = studios.find((entry) => entry.id === application.id);
  return shell({ active: 'studios', title: studio?.name || application.name, app: application.id, body: `
    <h1 class="page-title">${escape(studio?.name || application.name)}</h1>
    <p class="page-lede">${escape(description)}</p>
    <p class="stex-meta">This application is registered in the STEX alpha but is not implemented yet.</p>
    <p><a class="section-link" href="/studios/">All studios</a></p>` });
}
