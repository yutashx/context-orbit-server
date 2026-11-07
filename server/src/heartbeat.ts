export function heartbeatLine(uptimeSeconds: number, ready: boolean, host: string, port: number): string {
  return JSON.stringify({ event: 'receiver_heartbeat', uptimeSeconds: Math.max(0, Math.floor(uptimeSeconds)),
    host, port, storage: ready ? 'ready' : 'unavailable' }) + '\n';
}
export function startHeartbeat(intervalMs: number, startedAtMs: number, ready: () => boolean,
    host: string, port: number, write: (line: string) => void): { tick(atMs?: number): void; stop(): void } {
  const tick = (atMs: number = Date.now()) => {
    try {
      write(heartbeatLine((atMs - startedAtMs) / 1000, ready(), host, port));
    } catch { /* Logging must not stop the receiver. */ }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  let stopped = false;
  return { tick, stop: () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  } };
}
