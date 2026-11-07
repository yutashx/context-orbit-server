import { lstatSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join, parse } from 'node:path';
import { isIP } from 'node:net';
import { z } from 'zod';

const ConfigSchema = z.strictObject({
  stateDirectory: z.string().min(1),
  host: z.string().default('127.0.0.1'),
  port: z.number().int().min(1024).max(65535).default(18787),
  allowLanHttp: z.boolean().default(false),
});
export function requireOutsideGit(path: string): string {
  if (!isAbsolute(path)) throw new Error('absolute_path_required');
  const resolved = realpathSync(path);
  let current = resolved;
  while (true) {
    if (existsSync(join(current, '.git'))) throw new Error('state_must_be_outside_git');
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (resolved === parse(resolved).root) throw new Error('state_directory_required');
  return resolved;
}
function privateFile(path: string): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.()) {
    throw new Error('private_file_required');
  }
  return readFileSync(path, 'utf8');
}
export function validateHost(host: string, allowLanHttp: boolean): void {
  if (isIP(host) !== 4) throw new Error('literal_ipv4_required');
  const [first, second] = host.split('.').map(Number);
  if (first === 127) return;
  const privateAddress = first === 10 || (first === 172 && second !== undefined && second >= 16 && second <= 31) || (first === 192 && second === 168)
    || (first === 100 && second !== undefined && second >= 64 && second <= 127);
  if (!privateAddress || !allowLanHttp) throw new Error('lan_http_requires_private_address_and_opt_in');
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  if (!env.CONTEXT_ORBIT_CONFIG || !isAbsolute(env.CONTEXT_ORBIT_CONFIG)) throw new Error('config_file_required');
  const raw: unknown = JSON.parse(privateFile(env.CONTEXT_ORBIT_CONFIG));
  const initial = ConfigSchema.parse(raw);
  const port = env.CONTEXT_ORBIT_PORT;
  if (port !== undefined && !/^[0-9]+$/.test(port)) throw new Error('invalid_port');
  const allow = env.CONTEXT_ORBIT_ALLOW_LAN_HTTP;
  if (allow !== undefined && allow !== '0' && allow !== '1') throw new Error('invalid_lan_http_flag');
  const heartbeat = env.CONTEXT_ORBIT_HEARTBEAT_MS;
  if (heartbeat !== undefined && !/^[0-9]+$/.test(heartbeat)) throw new Error('invalid_heartbeat_interval');
  const heartbeatMs = heartbeat === undefined ? 60_000 : Number(heartbeat);
  if (heartbeatMs < 100 || heartbeatMs > 3_600_000) throw new Error('invalid_heartbeat_interval');
  const config = ConfigSchema.parse({ ...initial,
    host: env.CONTEXT_ORBIT_HOST ?? initial.host,
    port: port === undefined ? initial.port : Number(port),
    allowLanHttp: allow === undefined ? initial.allowLanHttp : allow === '1',
  });
  validateHost(config.host, config.allowLanHttp);
  const stateDirectory = requireOutsideGit(config.stateDirectory);
  const stat = lstatSync(stateDirectory);
  if (!stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) throw new Error('private_state_directory_required');
  const token = privateFile(join(stateDirectory, 'token')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('invalid_token');
  const databasePath = join(stateDirectory, 'receiver.sqlite');
  if (existsSync(databasePath)) {
    const dbStat = lstatSync(databasePath);
    if (!dbStat.isFile() || dbStat.isSymbolicLink() || (dbStat.mode & 0o777) !== 0o600 || dbStat.uid !== process.getuid?.()) throw new Error('private_database_required');
  }
  return { ...config, heartbeatMs, stateDirectory, token, databasePath };
}
