import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { requireOutsideGit } from './config.ts';

try {
  const directory = process.argv[2];
  if (process.argv.length !== 3 || !directory || !isAbsolute(directory)) throw new Error();
  requireOutsideGit(dirname(directory));
  // Exclusive directory creation: never overwrite an existing store or secret.
  mkdirSync(directory, { mode: 0o700 });
  writeFileSync(join(directory, 'token'), randomBytes(32).toString('hex') + '\n', { mode: 0o600, flag: 'wx' });
  writeFileSync(join(directory, 'config.json'), JSON.stringify({
    stateDirectory: directory, host: '127.0.0.1', port: 18787, allowLanHttp: false,
  }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write('{"event":"setup_created"}\n');
} catch {
  process.stderr.write('{"event":"setup_failed","code":"new_private_directory_required"}\n');
  process.exitCode = 1;
}
