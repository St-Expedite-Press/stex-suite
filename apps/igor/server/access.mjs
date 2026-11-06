// Hosted mode: Igor behind Cloudflare Tunnel and Cloudflare Access. Every
// request must carry the Access application token (Cf-Access-Jwt-Assertion),
// verified here against the team's published signing keys, so a missing or
// misconfigured Access policy can never leave Igor open.
import { createPublicKey, verify } from 'node:crypto';
import { IgorError } from './http.mjs';

const KEYS_TTL_MS = 10 * 60_000;
const REFETCH_GAP_MS = 30_000;
const SKEW_SECONDS = 60;
const loopbackUrl = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//;

const decode = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
const refused = () => new IgorError(403, 'FORBIDDEN', 'Sign in through Cloudflare Access to use Igor.');

/**
 * Reads hosted-mode settings. Returns null when Igor is local-only (no public
 * origin); throws when hosted mode is requested without its Access settings.
 */
export function hostedConfig(env) {
  const publicOrigin = (env.STEX_IGOR_PUBLIC_ORIGIN || '').trim();
  if (!publicOrigin) return null;
  let origin;
  try { origin = new URL(publicOrigin); } catch { throw new Error('STEX_IGOR_PUBLIC_ORIGIN is not a valid URL.'); }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username) throw new Error('STEX_IGOR_PUBLIC_ORIGIN must be an https origin such as https://igor.example.com.');
  const team = (env.STEX_IGOR_ACCESS_TEAM_DOMAIN || '').trim();
  const audience = (env.STEX_IGOR_ACCESS_AUD || '').trim();
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) throw new Error('Hosted Igor needs STEX_IGOR_ACCESS_TEAM_DOMAIN (<team>.cloudflareaccess.com).');
  if (!/^[a-f0-9]{64}$/.test(audience)) throw new Error('Hosted Igor needs STEX_IGOR_ACCESS_AUD (the Access application audience tag).');
  const certsUrl = (env.STEX_IGOR_ACCESS_CERTS_URL || `https://${team}/cdn-cgi/access/certs`).trim();
  if (!certsUrl.startsWith('https://') && !loopbackUrl.test(certsUrl)) throw new Error('STEX_IGOR_ACCESS_CERTS_URL must be https (or loopback for tests).');
  const emails = (env.STEX_IGOR_ACCESS_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  return { publicOrigin: origin.origin, publicHost: origin.host, issuer: `https://${team}`, audience, certsUrl, emails };
}

export function createAccessVerifier(config, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  let keys = new Map(); let fetchedAt = 0; let pending = null;

  async function refresh() {
    const response = await fetchImpl(config.certsUrl, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`certs ${response.status}`);
    const body = await response.json();
    const next = new Map();
    for (const jwk of Array.isArray(body?.keys) ? body.keys : []) {
      if (jwk?.kty === 'RSA' && typeof jwk.kid === 'string') next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }));
    }
    if (!next.size) throw new Error('certs had no RSA keys');
    keys = next; fetchedAt = now();
  }

  // One refresh at a time; an unknown kid refetches at most every 30 s.
  async function keyFor(kid) {
    const stale = now() - fetchedAt > KEYS_TTL_MS;
    if (stale || (!keys.has(kid) && now() - fetchedAt > REFETCH_GAP_MS)) {
      pending ??= refresh().finally(() => { pending = null; });
      try { await pending; }
      catch { if (!keys.size) throw new IgorError(503, 'UNAVAILABLE', 'Igor could not check your sign-in. Try again shortly.'); }
    }
    return keys.get(kid);
  }

  /** Resolves the verified claims, or throws a 403/503 IgorError. */
  return async function verifyRequest(headers) {
    const token = headers['cf-access-jwt-assertion'];
    if (typeof token !== 'string') throw refused();
    const parts = token.split('.');
    if (parts.length !== 3) throw refused();
    let header; let claims;
    try { header = decode(parts[0]); claims = decode(parts[1]); } catch { throw refused(); }
    if (header?.alg !== 'RS256' || typeof header.kid !== 'string') throw refused();
    const key = await keyFor(header.kid);
    if (!key || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], 'base64url'))) throw refused();
    const seconds = now() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== config.issuer || !audiences.includes(config.audience)) throw refused();
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < seconds) throw refused();
    if (typeof claims.nbf === 'number' && claims.nbf - SKEW_SECONDS > seconds) throw refused();
    if (config.emails.length && !config.emails.includes(String(claims.email || '').toLowerCase())) throw refused();
    return claims;
  };
}
