// stex.igor.interface.v1: load the existing renderer over the owned HTTP boundary.
// Pantheon imports no Igor modules/files and holds no conversation or secret.
const root = document.querySelector('#root');
try {
  const response = await fetch('/igor/api/interface', { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  const descriptor = await response.json();
  if (response.status === 401) {
    location.assign(`/igor/login?next=${encodeURIComponent(location.pathname + location.search)}`);
  } else {
    if (!response.ok) throw new Error(descriptor.error || 'Igor is not available locally.');
    const asset = (value, extension) => typeof value === 'string' && value.length <= 210 && new RegExp(`^/igor/assets/[A-Za-z0-9._-]+\\.${extension}$`).test(value);
    if (descriptor.schemaVersion !== 'stex.igor.interface.v1' || descriptor.policy !== 'igor-page.v1' || !asset(descriptor.entrypoint, 'js') || !Array.isArray(descriptor.styles) || !descriptor.styles.length || descriptor.styles.length > 8 || !descriptor.styles.every((file) => asset(file, 'css'))) throw new Error('Igor returned an incompatible interface.');
    await Promise.all(descriptor.styles.map((href) => new Promise((resolve, reject) => {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
      link.onload = resolve; link.onerror = () => reject(new Error('Igor’s interface styles could not load.'));
      document.head.append(link);
    })));
    await import(descriptor.entrypoint);
  }
} catch (error) {
  const message = document.createElement('p'); message.className = 'page'; message.setAttribute('role', 'status');
  message.textContent = `${error.message || 'Igor could not open.'} Start the local Igor service and reload.`;
  root.replaceChildren(message);
}
