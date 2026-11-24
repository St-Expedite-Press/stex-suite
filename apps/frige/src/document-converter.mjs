/**
 * Client for Frige's isolated MarkItDown converter (`document_convert.py`).
 *
 * When `STEX_FRIGE_CONVERTER_SOCKET` is set, every uploaded attachment is
 * sent to the converter over that local socket, and the Markdown it returns
 * becomes the attachment's text for the author to review and approve. The
 * converter never sees Frige's files: it receives only the uploaded bytes.
 */
import http from 'node:http';

/** Upper bound on a converter reply, in bytes. The converter caps its own Markdown at 600,000 bytes. */
const MAX_REPLY_BYTES = 2_000_000;
const CODE = /^[A-Z_]{1,40}$/;

/** A conversion that produced no Markdown, with a stable code the interface can show. */
export class ConversionError extends Error {
  /** @param {string} code */
  constructor(code) {
    super(`The document converter could not convert this file (${code}).`);
    this.code = code;
  }
}

/**
 * Returns a converter client, or `null` when no socket is configured.
 *
 * @param {{ socketPath?: string, timeoutMs?: number }} [options]
 * @returns {{ convert: (upload: { name: string, bytes: Buffer }) => Promise<{ markdown: string }> } | null}
 */
export function createDocumentConverter({ socketPath = '', timeoutMs = 90_000 } = {}) {
  if (!socketPath) return null;

  /**
   * Converts one upload. Rejects with a ConversionError carrying the
   * converter's code, `CONVERTER_UNAVAILABLE` or `CONVERSION_TIMEOUT`.
   */
  function convert({ name, bytes }) {
    const body = JSON.stringify({ name, contentBase64: bytes.toString('base64') });
    return new Promise((resolve, reject) => {
      const request = http.request({
        socketPath, path: '/v1/convert', method: 'POST', agent: false, timeout: timeoutMs,
        headers: { host: 'localhost', 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
      }, (response) => {
        const chunks = []; let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_REPLY_BYTES) { response.destroy(); reject(new ConversionError('CONVERSION_FAILED')); } else chunks.push(chunk);
        });
        response.on('error', () => reject(new ConversionError('CONVERTER_UNAVAILABLE')));
        response.on('end', () => {
          let reply;
          try { reply = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new ConversionError('CONVERSION_FAILED')); }
          if (response.statusCode === 200 && typeof reply?.markdown === 'string' && reply.markdown.trim()) return resolve({ markdown: reply.markdown });
          const code = reply?.error?.code;
          reject(new ConversionError(typeof code === 'string' && CODE.test(code) ? code : 'CONVERSION_FAILED'));
        });
      });
      request.on('timeout', () => request.destroy(new ConversionError('CONVERSION_TIMEOUT')));
      request.on('error', (error) => reject(error instanceof ConversionError ? error : new ConversionError('CONVERTER_UNAVAILABLE')));
      request.end(body);
    });
  }
  return { convert };
}
