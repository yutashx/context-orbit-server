import { timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { toJsonString } from '@bufbuild/protobuf';
import { ReceiptSchema as ReceiptDescriptor } from './generated/receiver_pb.js';
import { MAX_BODY_BYTES, MAX_RECORD_BYTES, MAX_RECORDS, ReceiverError } from './protocol.ts';
import type { ReceiverStore } from './store.ts';

export const READ_TIMEOUT_MS = 10_000;
export const MAX_ACTIVE_REQUESTS = 4;
class BodyError extends Error {
  readonly status: 408 | 413;
  constructor(status: 408 | 413) { super('body_rejected'); this.status = status; }
}
async function readBounded(request: Request): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BodyError(408)), READ_TIMEOUT_MS);
    timer.unref();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new BodyError(413);
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}
export function createApp(store: ReceiverStore, token: string) {
  const app = new Hono();
  let active = 0;
  const expected = Buffer.from(`Bearer ${token}`);
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    const presented = Buffer.from(c.req.header('authorization') ?? '');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) return c.json({ code: 'unauthorized' }, 401);
    if (active >= MAX_ACTIVE_REQUESTS) return c.json({ code: 'busy' }, 429, { 'Retry-After': '2' });
    active++;
    try { await next(); } finally { active--; }
  });
  app.get('/v1/server', c => {
    if (!store.ready()) return c.json({ code: 'storage_unavailable' }, 503);
    return c.json({ protocolVersion: 1, serverId: store.serverId,
      limits: { bodyBytes: MAX_BODY_BYTES, recordBytes: MAX_RECORD_BYTES, records: MAX_RECORDS } });
  });
  app.post('/v1/batches', async c => {
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(c.req.header('content-type') ?? '')) return c.json({ code: 'unsupported_media_type' }, 415);
    if ((c.req.header('content-encoding') ?? 'identity').toLowerCase() !== 'identity') return c.json({ code: 'unsupported_encoding' }, 415);
    const length = c.req.header('content-length');
    if (length !== undefined && (!/^[0-9]+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return c.json({ code: 'body_too_large' }, 413);
    try {
      const body = await readBounded(c.req.raw);
      return new Response(toJsonString(ReceiptDescriptor, store.ingest(body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (error) {
      if (error instanceof BodyError) return c.json({ code: error.status === 413 ? 'body_too_large' : 'request_timeout' }, error.status);
      if (error instanceof ReceiverError) {
        const status = error.code === 'wrong_server' || error.code === 'identity_conflict' ? 409 : (error.code === 'record_too_large' ? 413 : 400);
        // Legacy responses expose only the documented frozen codes; typed reasons
        // stay on the Connect path.
        return c.json({ code: status === 400 ? 'invalid_request' : error.code }, status);
      }
      return c.json({ code: 'storage_unavailable' }, 503);
    }
  });
  app.notFound(c => c.json({ code: 'not_found' }, 404));
  app.onError(cause => {
    void cause;
    return Response.json({ code: 'internal_error' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  });
  return app;
}
