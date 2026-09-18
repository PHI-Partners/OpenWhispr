#!/usr/bin/env node

/**
 * Fake HTTP model host for testing model downloads.
 *
 * Switchable behaviors:
 *   normal / range-supported  Supports HTTP Range requests (returns 206 with Content-Range)
 *   range-ignored             Ignores HTTP Range requests (returns 200 with full body)
 *   truncated:<bytes>         Sends <bytes> then destroys the socket/stream
 *   stalled:<afterBytes>      Sends <afterBytes> then stops sending data without ending
 *   404 / not-found           Returns HTTP 404
 *   500 / server-error        Returns HTTP 500
 *   500-then-ok:<count>       Returns HTTP 500 for the first <count> requests, then normal
 *   slow-trickle:<chunk>:<ms> Sends data in chunks of <chunk> bytes with <ms> delay
 *   wrong-content             Sends corrupted bytes of the expected length (hash mismatch)
 *
 * Behaviors and lengths can be controlled via:
 *   - CLI flags: --port <port>, --behavior <mode>, --length <bytes>
 *   - HTTP request headers: x-fake-behavior, x-fake-length
 *   - HTTP query parameters: ?behavior=<mode>&length=<bytes>
 *   - Control endpoint: POST /control { behavior, length }
 */

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { setInterval, clearInterval } from 'node:timers';

// ── Deterministic byte pattern generation ──

const DEFAULT_LENGTH = 64 * 1024; // 64 KB

/**
 * Generates a deterministic byte buffer of given length.
 * Pattern: repeating 256-byte sequence based on formula `(i * 31 + 17) & 0xff`.
 * @param {number} length
 * @returns {Buffer}
 */
export function generateScriptedBytes(length) {
  const buf = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) {
    buf[i] = (i * 31 + 17) & 0xff;
  }
  return buf;
}

/**
 * Generates wrong/corrupted byte buffer of given length.
 * Pattern: filled with 0x55 so SHA-256 differs from `generateScriptedBytes`.
 * @param {number} length
 * @returns {Buffer}
 */
export function generateCorruptBytes(length) {
  const buf = Buffer.alloc(length);
  buf.fill(0x55);
  return buf;
}

/**
 * Returns SHA-256 hex digest of scripted bytes for given length.
 * @param {number} length
 * @returns {string}
 */
export function computeScriptedSha256(length) {
  return createHash('sha256').update(generateScriptedBytes(length)).digest('hex');
}

// ── Server Factory ──

/**
 * @typedef {Object} FakeModelHostOptions
 * @property {number} [port]
 * @property {string} [host]
 * @property {string} [behavior]
 * @property {number} [length]
 */

/**
 * @typedef {Object} FakeModelHostInstance
 * @property {import('node:http').Server} server
 * @property {number} port
 * @property {string} url
 * @property {(behavior: string) => void} setBehavior
 * @property {(length: number) => void} setLength
 * @property {() => Promise<void>} close
 */

/**
 * Creates and starts a fake model host HTTP server.
 * @param {FakeModelHostOptions} [options]
 * @returns {Promise<FakeModelHostInstance>}
 */
export function createFakeModelHost(options = {}) {
  let currentBehavior = options.behavior ?? 'normal';
  let defaultLength = options.length ?? DEFAULT_LENGTH;
  let errorCountRemaining = 0;
  let truncateCountRemaining = 0;

  /** @param {string} behavior */
  function updateErrorCount(behavior) {
    if (behavior.startsWith('500-then-ok:')) {
      errorCountRemaining = parseInt(behavior.slice('500-then-ok:'.length), 10) || 0;
    } else {
      errorCountRemaining = 0;
    }

    if (behavior.startsWith('truncate-once:')) {
      truncateCountRemaining = 1;
    } else if (behavior.startsWith('truncated-then-ok:')) {
      const parts = behavior.split(':');
      truncateCountRemaining = parseInt(parts[2], 10) || 1;
    } else {
      truncateCountRemaining = 0;
    }
  }

  updateErrorCount(currentBehavior);

  const server = createServer((req, res) => {
    const reqUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

    // Control endpoint for dynamic behavioral reconfiguration
    if (req.method === 'POST' && reqUrl.pathname === '/control') {
      let bodyStr = '';
      req.on('data', (c) => {
        bodyStr += String(c);
      });
      req.on('end', () => {
        try {
          /** @type {unknown} */
          const parsed = JSON.parse(bodyStr || '{}');
          const data =
            typeof parsed === 'object' && parsed !== null
              ? /** @type {Record<string, unknown>} */ (parsed)
              : {};
          if (typeof data.behavior === 'string') {
            currentBehavior = data.behavior;
            updateErrorCount(currentBehavior);
          }
          if (typeof data.length === 'number') {
            defaultLength = data.length;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', behavior: currentBehavior, length: defaultLength }));
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Determine behavior for this request
    const headerBehavior = req.headers['x-fake-behavior'];
    const queryBehavior = reqUrl.searchParams.get('behavior');
    const behavior =
      typeof headerBehavior === 'string'
        ? headerBehavior
        : typeof queryBehavior === 'string'
          ? queryBehavior
          : currentBehavior;

    // Determine payload length
    const headerLength = req.headers['x-fake-length'];
    const queryLength = reqUrl.searchParams.get('length');
    const length =
      typeof headerLength === 'string'
        ? parseInt(headerLength, 10)
        : typeof queryLength === 'string'
          ? parseInt(queryLength, 10)
          : defaultLength;

    // Check temporary 500 error count
    if (behavior.startsWith('500-then-ok:')) {
      if (errorCountRemaining > 0) {
        errorCountRemaining -= 1;
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Simulated internal server error (retry countdown)');
        return;
      }
    }

    // Fixed error responses
    if (behavior === '404' || behavior === 'not-found') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    if (behavior === '500' || behavior === 'server-error') {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
      return;
    }

    // Generate response content
    const isWrongContent = behavior === 'wrong-content';
    const fullBody = isWrongContent ? generateCorruptBytes(length) : generateScriptedBytes(length);

    // Parse Range header if present
    const rangeHeader = req.headers.range;
    const ignoreRange = behavior === 'range-ignored';

    let statusCode = 200;
    /** @type {Record<string, string | number>} */
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': 'application/octet-stream',
    };
    let responseData = fullBody;

    if (rangeHeader && !ignoreRange) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/);
      if (match) {
        const start = parseInt(match[1], 10);
        const end = match[2] ? parseInt(match[2], 10) : length - 1;

        if (start >= length || (match[2] && end < start)) {
          res.writeHead(416, {
            'Content-Range': `bytes */${length}`,
          });
          res.end();
          return;
        }

        statusCode = 206;
        headers['Content-Range'] = `bytes ${start}-${end}/${length}`;
        headers['Content-Length'] = end - start + 1;
        responseData = fullBody.subarray(start, end + 1);
      } else {
        headers['Content-Length'] = length;
      }
    } else {
      headers['Content-Length'] = length;
    }

    // Handle failure modes during streaming
    if (
      behavior.startsWith('truncated:') ||
      behavior.startsWith('truncate-once:') ||
      behavior.startsWith('truncated-then-ok:')
    ) {
      const truncateAt = behavior.startsWith('truncate-once:')
        ? parseInt(behavior.slice('truncate-once:'.length), 10) || 0
        : behavior.startsWith('truncated-then-ok:')
          ? parseInt(behavior.split(':')[1], 10) || 0
          : parseInt(behavior.slice('truncated:'.length), 10) || 0;

      res.writeHead(statusCode, headers);
      res.flushHeaders();

      if (truncateCountRemaining > 0) {
        truncateCountRemaining -= 1;
        if (truncateCountRemaining === 0) {
          currentBehavior = 'normal';
        }
      }

      if (truncateAt > 0) {
        res.write(responseData.subarray(0, truncateAt), () => {
          req.socket.destroy();
        });
      } else {
        req.socket.destroy();
      }
      return;
    }

    if (behavior.startsWith('stalled:')) {
      const sendBeforeStall = parseInt(behavior.slice('stalled:'.length), 10) || 0;
      res.writeHead(statusCode, headers);
      res.flushHeaders();
      if (sendBeforeStall > 0) {
        res.write(responseData.subarray(0, sendBeforeStall));
      }
      // Do not end the response; leave connection stalled
      return;
    }

    if (behavior.startsWith('slow-trickle:')) {
      const parts = behavior.slice('slow-trickle:'.length).split(':');
      const chunkSize = parseInt(parts[0], 10) || 1024;
      const delayMs = parseInt(parts[1], 10) || 50;

      res.writeHead(statusCode, headers);
      let offset = 0;
      const interval = setInterval(() => {
        if (req.socket.destroyed || res.destroyed) {
          clearInterval(interval);
          return;
        }
        if (offset >= responseData.length) {
          clearInterval(interval);
          res.end();
          return;
        }
        const chunk = responseData.subarray(offset, offset + chunkSize);
        offset += chunkSize;
        res.write(chunk);
      }, delayMs);
      return;
    }

    // Normal streaming
    res.writeHead(statusCode, headers);
    res.end(responseData);
  });

  return new Promise((resolve, reject) => {
    const port = options.port ?? 0;
    const host = options.host ?? '127.0.0.1';

    server.listen(port, host, () => {
      const addr = server.address();
      const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://${host}:${resolvedPort}`;

      resolve({
        server,
        port: resolvedPort,
        url,
        setBehavior(b) {
          currentBehavior = b;
          updateErrorCount(b);
        },
        setLength(l) {
          defaultLength = l;
        },
        close() {
          return new Promise((resClose) => {
            server.closeAllConnections();
            server.close(() => resClose());
          });
        },
      });
    });

    server.on('error', reject);
  });
}

// ── CLI Execution ──

if (process.argv[1] && process.argv[1].endsWith('fake-model-host.mjs')) {
  const argv = process.argv.slice(2);
  /** @param {string} name */
  function getArg(name) {
    const i = argv.indexOf(name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  }

  const port = parseInt(getArg('--port') ?? '8190', 10);
  const behavior = getArg('--behavior') ?? 'normal';
  const length = parseInt(getArg('--length') ?? String(DEFAULT_LENGTH), 10);

  void createFakeModelHost({ port, behavior, length }).then(({ url }) => {
    process.stderr.write(`fake-model-host listening on ${url} (behavior=${behavior}, length=${length})\n`);
  });
}
