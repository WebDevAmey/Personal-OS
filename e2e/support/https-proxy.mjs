// e2e/support/https-proxy.mjs — local TLS front for `next start` in E2E runs.
//
// Production mode requires an https NEXT_PUBLIC_APP_URL (lib/env.ts) and
// trusts only that origin for CSRF (lib/security/csrf.ts), and session
// cookies carry the __Host- prefix with Secure. Serving the app through
// https://localhost:<PROXY_PORT> keeps all of that real in the browser.
//
// The same process runs a stand-in Inngest event API on INNGEST_SINK_PORT so
// page-load briefing enqueues succeed without contacting Inngest cloud.
//
//   node e2e/support/https-proxy.mjs   (env: PROXY_PORT, APP_PORT, INNGEST_SINK_PORT)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROXY_PORT = Number(process.env.PROXY_PORT ?? 3443);
const APP_PORT = Number(process.env.APP_PORT ?? 3000);
const SINK_PORT = Number(process.env.INNGEST_SINK_PORT ?? 3999);

// Throwaway self-signed certificate for localhost; never committed.
const dir = mkdtempSync(join(tmpdir(), 'pos-e2e-tls-'));
const key = join(dir, 'key.pem');
const cert = join(dir, 'cert.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=localhost'], { stdio: 'ignore' });

https
  .createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    const upstream = http.request(
      { host: '127.0.0.1', port: APP_PORT, path: req.url, method: req.method, headers: { ...req.headers, 'x-forwarded-proto': 'https' } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('upstream unavailable');
    });
    req.pipe(upstream);
  })
  .listen(PROXY_PORT);

// Inngest event API stand-in: accepts POST /e/<key> and returns ids.
http
  .createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let count = 1;
      try {
        const parsed = JSON.parse(body || '[]');
        count = Array.isArray(parsed) ? parsed.length : 1;
      } catch {
        // ignore
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ids: Array.from({ length: count }, (_, i) => `e2e-event-${Date.now()}-${i}`), status: 200 }));
    });
  })
  .listen(SINK_PORT, '127.0.0.1');
