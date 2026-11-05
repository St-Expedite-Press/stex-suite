export function previewTarget(value) {
  if (typeof value !== 'string') throw new Error('Preview is not started.');
  let target;
  try { target = new URL(value); } catch { throw new Error('Stored preview target is invalid.'); }
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port || target.username || target.password) throw new Error('Stored preview target is not an allowed loopback HTTP address.');
  return target;
}

export function previewPath(value) {
  const supplied = String(value || '');
  if (supplied.includes('\\')) throw new Error('Invalid preview path.');
  const segments = supplied.split('/').filter(Boolean);
  if (segments.some((segment) => { try { const decoded = decodeURIComponent(segment); return decoded === '.' || decoded === '..' || decoded.includes('\\'); } catch { return true; } })) throw new Error('Invalid preview path.');
  return `/${segments.map(encodeURIComponent).join('/')}`;
}
