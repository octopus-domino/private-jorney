import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./fetch_source.py', import.meta.url));
const MAX_ACTIVE = 4;
const MAX_CACHE_ENTRIES = 16;
const TIMEOUT_MS = 28000;

/** Vite-only adapter. Browser cancellation releases the child process when its last subscriber leaves. */
export class HistorySourceGateway {
  constructor(execute = execFile) {
    this.execute = execute;
    this.cache = new Map();
    this.pending = new Map();
    this.active = 0;
  }

  /** Implements Connect middleware without retaining abandoned jobs behind a new house request. */
  handle = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/history-source') return next();
    if (!['GET', 'POST'].includes(req.method)) { res.writeHead(405).end(); return; }
    const source = url.searchParams.get('url');
    if (!source || source.length > 16000) { res.writeHead(400).end(); return; }
    if (req.method === 'POST') {
      if (source !== 'https://api.cian.ru/search-engine/v1/search-offers-mobile-site/') return this.reply(res, 405, 'Unsupported source POST');
      this.readBody(req).then(body => { if (!res.destroyed) this.dispatch(source, res, 'POST', body); })
        .catch(() => this.reply(res, 400, 'Invalid source JSON request'));
      return;
    }
    this.dispatch(source, res);
  };

  async readBody(req) {
    let body = '';
    for await (const chunk of req) {
      body += chunk.toString('utf8');
      if (Buffer.byteLength(body) > 32768) throw new Error('Source request too large');
    }
    JSON.parse(body);
    return body;
  }

  dispatch(source, res, method = 'GET', body = '') {
    const key = method === 'GET' ? source : `${source}:${body}`;
    const cached = this.cache.get(source);
    if (method === 'GET' && cached && cached.expires > Date.now()) return this.reply(res, 200, cached.body);
    const job = this.pending.get(key) ?? this.start(source, key, method, body);
    if (!job) return this.reply(res, 503, 'Source busy');
    this.subscribe(job, res);
  }

  start(source, key, method, body) {
    if (this.active >= MAX_ACTIVE) return null;
    this.active++;
    const job = { source, key, method, consumers: new Set(), finished: false, child: null };
    this.pending.set(key, job);
    job.child = this.execute(process.env.HISTORY_PYTHON ?? 'python', [SCRIPT, source, method], {
      timeout: TIMEOUT_MS, maxBuffer: 12 * 1024 * 1024, windowsHide: true, encoding: 'utf8',
    }, (error, stdout) => this.complete(job, error, stdout));
    if (method === 'POST') job.child.stdin.end(body);
    return job;
  }

  subscribe(job, res) {
    job.consumers.add(res);
    res.once('close', () => {
      job.consumers.delete(res);
      if (job.finished || job.consumers.size > 0) return;
      // Remove the cancelled job immediately; a new subscription must start fresh.
      if (this.pending.get(job.key) === job) this.pending.delete(job.key);
      job.child?.kill();
    });
  }

  complete(job, error, body) {
    job.finished = true;
    this.active--;
    if (this.pending.get(job.key) === job) this.pending.delete(job.key);
    if (!error && job.consumers.size && job.method === 'GET') this.remember(job.source, body);
    const status = !error ? 200 : error.code === 43 ? 403 : error.code === 44 ? 404 : error.code === 45 ? 503 : 502;
    for (const res of job.consumers) this.reply(res, status, error ? 'Public source unavailable' : body);
    job.consumers.clear();
  }

  remember(source, body) {
    const host = new URL(source).hostname;
    if (!['www.citywalls.ru', 'gorod.gov.spb.ru', 'um.mos.ru'].includes(host)) return;
    if (this.cache.size >= MAX_CACHE_ENTRIES) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(source, { body, expires: Date.now() + (host === 'www.citywalls.ru' ? 3600000 : 300000) });
  }

  reply(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  }
}

export const historyProxy = new HistorySourceGateway().handle;
