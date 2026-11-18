/** Project-owned lifecycle commands. All children have a whitelisted, credential-free environment. */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const win = process.platform === 'win32';
const python = join(root, 'services/knowledge/.venv', win ? 'Scripts/python.exe' : 'bin/python');
const runtimePath = join(root, '.local/private/runtime.json');
const processPath = join(root, '.local/private/processes.json');
const childEnvironment = () => {
  const allowed = [
    'PATH',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'LOCALAPPDATA',
    'APPDATA',
    'COMSPEC',
    'PATHEXT',
    'NUMBER_OF_PROCESSORS',
    'PROCESSOR_ARCHITECTURE',
    'LANG',
    'LC_ALL',
  ];
  const env = {};
  for (const [key, value] of Object.entries(process.env))
    if (allowed.some((item) => item.toLowerCase() === key.toLowerCase()) && value !== undefined)
      env[key] = value;
  return {
    ...env,
    PYTHONUTF8: '1',
    PYTHONUNBUFFERED: '1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
  };
};
mkdirSync(join(root, '.local/private'), { recursive: true });
mkdirSync(join(root, '.local/delivery'), { recursive: true });

function run(executable, args, cwd = root) {
  const result = spawnSync(executable, args, {
    cwd,
    env: childEnvironment(),
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error('Command failed: ' + executable + ' ' + args.join(' '));
}
function npm(args) {
  const cli = process.env.npm_execpath;
  if (cli && existsSync(cli)) run(process.execPath, [cli, ...args]);
  else if (win) run('cmd.exe', ['/d', '/s', '/c', 'npm ' + args.join(' ')]);
  else run('npm', args);
}
function runtime() {
  if (!existsSync(runtimePath))
    writeFileSync(
      runtimePath,
      JSON.stringify(
        {
          instanceId: randomUUID(),
          serviceKey: randomBytes(32).toString('base64url'),
          mode: 'fixture',
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
  return JSON.parse(readFileSync(runtimePath, 'utf8'));
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function owned(item) {
  if (!Number.isInteger(item.pid) || item.pid < 1 || !alive(item.pid)) return false;
  let command;
  if (win) {
    const script = `$p=Get-CimInstance Win32_Process -Filter 'ProcessId = ${item.pid}'; if($p){$p.CommandLine}`;
    command = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true },
    ).toLowerCase();
  } else
    command = execFileSync('ps', ['-p', String(item.pid), '-o', 'command='], {
      encoding: 'utf8',
    }).toLowerCase();
  const normalized = command.replaceAll('\\', '/');
  return item.kind === 'api'
    ? normalized.includes(join(root, 'apps/api/dist/index.js').replaceAll('\\', '/').toLowerCase())
    : item.kind === 'data' &&
        normalized.includes(python.replaceAll('\\', '/').toLowerCase()) &&
        normalized.includes('cleardesk.main:deployment_app') &&
        normalized.includes('4281');
}
async function stop() {
  if (!existsSync(processPath)) {
    console.log('No owned ClearDesk processes recorded.');
    return;
  }
  const record = JSON.parse(readFileSync(processPath, 'utf8'));
  if (resolve(record.root) !== resolve(root))
    throw new Error('Process ownership manifest belongs to another directory.');
  for (const item of [...record.processes].reverse()) {
    if (!alive(item.pid)) continue;
    if (!owned(item))
      throw new Error('Refusing to stop a process whose ClearDesk ownership cannot be verified.');
    process.kill(item.pid, 'SIGTERM');
  }
  for (let count = 0; count < 40 && record.processes.some((item) => alive(item.pid)); count++)
    await pause(250);
  if (record.processes.some((item) => alive(item.pid)))
    throw new Error('An owned process has not stopped yet.');
  writeFileSync(processPath, JSON.stringify({ root, processes: [] }, null, 2) + '\n');
  console.log('Stopped the recorded ClearDesk processes.');
}
const portBusy = (port) =>
  new Promise((done) => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      done(true);
    });
    socket.once('error', () => done(false));
  });
async function up() {
  const config = runtime();
  if (existsSync(processPath)) {
    const record = JSON.parse(readFileSync(processPath, 'utf8'));
    const living = record.processes.filter((item) => alive(item.pid));
    if (living.length) {
      if (living.length === 2 && living.every(owned)) {
        const response = await fetch('http://127.0.0.1:4280/api/status').catch(() => null);
        if (response?.ok) {
          console.log('ClearDesk is already running at http://127.0.0.1:4280');
          return;
        }
      }
      throw new Error('A partial recorded instance exists. Run npm run stop before restarting.');
    }
  }
  if ((await portBusy(4280)) || (await portBusy(4281)))
    throw new Error('A required port is occupied. No existing process was modified.');
  if (!existsSync(python) || !existsSync(join(root, '.local/private/demo-accounts.json')))
    throw new Error('Run npm run bootstrap first.');
  npm(['run', 'build']);
  const record = { root, instanceId: config.instanceId, processes: [] };
  for (const item of [
    {
      kind: 'data',
      executable: python,
      args: [
        '-m',
        'uvicorn',
        'cleardesk.main:deployment_app',
        '--factory',
        '--host',
        '127.0.0.1',
        '--port',
        '4281',
        '--no-access-log',
        '--log-level',
        'warning',
      ],
      cwd: join(root, 'services/knowledge'),
    },
    {
      kind: 'api',
      executable: process.execPath,
      args: [join(root, 'apps/api/dist/index.js')],
      cwd: root,
    },
  ]) {
    const log = openSync(join(root, '.local/delivery/' + item.kind + '-server.log'), 'a');
    const child = spawn(item.executable, item.args, {
      cwd: item.cwd,
      env: { ...childEnvironment(), NODE_ENV: 'production' },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    if (!child.pid) throw new Error('Unable to start the owned ' + item.kind + ' service.');
    record.processes.push({ kind: item.kind, pid: child.pid });
    writeFileSync(processPath, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    child.unref();
  }
  for (let count = 0; count < 120; count++) {
    const response = await fetch('http://127.0.0.1:4280/api/status', {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (response?.ok) {
      console.log('ClearDesk is ready at http://127.0.0.1:4280 (' + config.mode + ' mode).');
      return;
    }
    if (record.processes.some((item) => !alive(item.pid))) break;
    await pause(250);
  }
  await stop();
  throw new Error('ClearDesk did not become ready. Review the private service logs.');
}

try {
  const command = process.argv[2];
  if (command === 'bootstrap') {
    runtime();
    if (!existsSync(python)) run('python', ['-m', 'venv', join(root, 'services/knowledge/.venv')]);
    npm(['ci', '--ignore-scripts', '--include=dev']);
    run(python, [
      '-m',
      'pip',
      'install',
      '--require-hashes',
      '--only-binary=:all:',
      '-r',
      'services/knowledge/requirements.lock',
    ]);
    run(python, ['scripts/prepare_embeddings.py']);
    run(python, ['scripts/seed_demo.py']);
    npm(['run', 'build']);
    console.log(
      'Bootstrap complete. Generated demo passwords are in .local/private/demo-accounts.json.',
    );
  } else if (command === 'up') await up();
  else if (command === 'stop') await stop();
  else if (command === 'verify') {
    npm(['run', 'typecheck']);
    npm(['test']);
    run(python, [
      '-m',
      'ruff',
      'check',
      'services/knowledge/cleardesk',
      'services/knowledge/tests',
      'scripts',
    ]);
    run(python, ['-m', 'pytest', '-q'], join(root, 'services/knowledge'));
    npm(['run', 'build']);
    run(process.execPath, ['scripts/scan-secrets.mjs']);
  } else if (command === 'rehearse')
    run(process.execPath, ['--import', 'tsx', 'verification/rehearse.ts']);
  else throw new Error('Use bootstrap, up, stop, verify or rehearse.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ClearDesk command failed.');
  process.exitCode = 1;
}
