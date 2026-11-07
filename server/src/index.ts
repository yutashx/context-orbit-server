import { getRequestListener } from '@hono/node-server';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { writeSync, realpathSync } from 'node:fs';
import { createRpcHandler } from './rpc.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { ReceiverStore } from './store.ts';
import { startHeartbeat } from './heartbeat.ts';

type NodeHandler = (request: IncomingMessage, response: ServerResponse) => void;
const MAX_RPC_ACTIVE = 4;
// Hand-serialized FailureDetail (reason field 1, requestId field 2,
// retryAfterSeconds field 4) so pre-interception failures still carry the
// typed contract; the requestId has no matching diagnostic line by design.
function failureDetailValue(reason: number, retryAfterSeconds?: number): { requestId: string; value: string } {
  const requestId = randomUUID();
  const raw = Buffer.from(requestId);
  const detail = Buffer.concat([Buffer.from([0x08, reason, 0x12, raw.length]), raw,
    ...(retryAfterSeconds === undefined ? [] : [Buffer.from([0x20, retryAfterSeconds])])]);
  return { requestId, value: detail.toString('base64') };
}
function connectError(response: ServerResponse, status: number, code: string, message: string, detailValue?: string): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ code, message,
    ...(detailValue === undefined ? {} : { details: [{ type: 'orbit.transfer.v1.FailureDetail', value: detailValue }] }) }));
}
/// HTTP boundary for the Connect adapter: authority, method, media type, auth,
/// and intake capacity are enforced before the request body is read, and
/// synchronous adapter failures cannot escape into the process.
export function createRequestListener(rpc: NodeHandler, expected: Buffer, legacy?: NodeHandler,
    onFailure?: (entry: Record<string, unknown>) => void): NodeHandler {
  const methodName = (url: string | undefined) => ((url ?? '').split('?', 1)[0] ?? '').split('/').pop() || 'unknown';
  let rpcActive = 0;
  return (request, response) => {
    if (!request.url?.startsWith('/orbit.transfer.v1.Receiver/')) {
      if (legacy) void legacy(request, response);
      else { response.writeHead(404); response.end(); }
      return;
    }
    try {
      const authority = request.headers.host;
      if (authority === undefined) throw new Error('authority_missing');
      new URL(request.url, `http://${authority}`);
    } catch {
      request.resume();
      connectError(response, 400, 'invalid_argument', 'Malformed request authority');
      return;
    }
    if (request.method !== 'POST') { request.resume(); connectError(response, 404, 'unimplemented', 'Not found'); return; }
    if (!((request.headers['content-type'] ?? '').split(';', 1)[0] ?? '').trim().toLowerCase().startsWith('application/proto')) {
      request.resume(); connectError(response, 415, 'unimplemented', 'Unsupported media type'); return;
    }
    const presented = Buffer.from(request.headers.authorization ?? '');
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      request.resume();
      const detail = failureDetailValue(1);
      try { onFailure?.({ event: 'receiver_rpc_failure', method: methodName(request.url), requestId: detail.requestId, reason: 'AUTHENTICATION_REQUIRED' }); } catch { /* diagnostics must not fail the request */ }
      connectError(response, 401, 'unauthenticated', 'Update server credentials', detail.value); return;
    }
    if (rpcActive >= MAX_RPC_ACTIVE) {
      request.resume();
      const detail = failureDetailValue(15, 30);
      try { onFailure?.({ event: 'receiver_rpc_failure', method: methodName(request.url), requestId: detail.requestId, reason: 'SERVER_BUSY' }); } catch { /* diagnostics must not fail the request */ }
      connectError(response, 503, 'unavailable', 'Receiver busy; waiting to retry', detail.value); return;
    }
    rpcActive++;
    let settled = false;
    // Keep-alive connections close once per socket, not per request: release
    // on response finish and on premature disconnect.
    const release = () => { if (!settled) { settled = true; rpcActive--; } };
    response.once('finish', release);
    response.once('close', release);
    try { void rpc(request, response); }
    catch { release(); response.destroy(); }
  };
}

function main(): void {
  process.umask(0o077);
  try {
    const config = loadConfig();
  const store = new ReceiverStore(config.databasePath);
  const legacy = getRequestListener(createApp(store, config.token).fetch);
  // One bounded synchronous line avoids a growing stderr buffer under backpressure.
  const rpc = createRpcHandler(store, config.token, entry => { writeSync(process.stderr.fd, JSON.stringify(entry) + '\n'); });
  const expected = Buffer.from(`Bearer ${config.token}`);
  const diagnostics = (entry: Record<string, unknown>) => { writeSync(process.stderr.fd, JSON.stringify(entry) + '\n'); };
  const server = createServer(createRequestListener(rpc, expected, legacy, diagnostics));
  server.listen(config.port, config.host, () => {
    process.stdout.write('{"event":"receiver_listening","transport":"http","api":"connect-with-v1-transition"}\n');
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxConnections = 16;
  server.maxRequestsPerSocket = 100;
  const heartbeat = startHeartbeat(config.heartbeatMs, Date.now(), () => store.ready(), config.host, config.port,
    line => writeSync(process.stdout.fd, line));
  server.on('error', () => {
    process.stderr.write('{"event":"receiver_failed","code":"listen_failure"}\n');
    store.close();
    process.exitCode = 1;
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    heartbeat.stop();
    // All writes are synchronous and committed before the handler returns.
    // Stop new connections and let bounded active requests finish first.
    server.close(() => {
      store.close();
      process.stdout.write('{"event":"receiver_stopped"}\n');
    });
    server.closeIdleConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  } catch {
    process.stderr.write('{"event":"receiver_failed","code":"configuration_or_storage_invalid"}\n');
    process.exitCode = 1;
  }
}

// Tests import the boundary helpers without booting the receiver.
const invoked = process.argv[1] ? realpathSync(process.argv[1]) : '';
if (invoked === realpathSync(import.meta.filename)) main();
