/** Project-owned lifecycle commands. All children have a whitelisted, credential-free environment. */
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { setTimeout as pause } from 'node:timers/promises';
import { stateDirectory } from './state.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const win = process.platform === 'win32';
const python = join(root, 'services/knowledge/.venv', win ? 'Scripts/python.exe' : 'bin/python');
/** Runtime state files: the owner's `.local`, or one isolated `.local/acceptance/<name>`. */
const statePaths = (value) => {
  const state = stateDirectory(root, value);
  return {
    value: value || '',
    runtime: join(state, 'private/runtime.json'),
    processes: join(state, 'private/processes.json'),
    accounts: join(state, 'private/demo-accounts.json'),
    delivery: join(state, 'delivery'),
  };
};
const ownerState = statePaths(process.env.CLEARDESK_STATE);
const stateEnvironment = (paths) => (paths.value ? { CLEARDESK_STATE: paths.value } : {});
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
    PYTHONPATH: join(root, 'services/knowledge'),
    PYTHONUNBUFFERED: '1',
    HF_HUB_DISABLE_IMPLICIT_TOKEN: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
  };
};
mkdirSync(dirname(ownerState.runtime), { recursive: true });
mkdirSync(ownerState.delivery, { recursive: true });

function run(executable, args, cwd = root, extraEnvironment = {}) {
  const result = spawnSync(executable, args, {
    cwd,
    env: { ...childEnvironment(), ...extraEnvironment },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error('Command failed: ' + executable + ' ' + args.join(' '));
}
function npm(args, extraEnvironment = {}) {
  const cli = process.env.npm_execpath;
  if (cli && existsSync(cli)) run(process.execPath, [cli, ...args], root, extraEnvironment);
  else if (win) run('cmd.exe', ['/d', '/s', '/c', 'npm ' + args.join(' ')], root, extraEnvironment);
  else run('npm', args, root, extraEnvironment);
}
function runtime(paths = ownerState) {
  if (!existsSync(paths.runtime))
    writeFileSync(
      paths.runtime,
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
  return JSON.parse(readFileSync(paths.runtime, 'utf8'));
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
async function stop(paths = ownerState) {
  if (!existsSync(paths.processes)) {
    console.log('No owned ClearDesk processes recorded.');
    return;
  }
  const record = JSON.parse(readFileSync(paths.processes, 'utf8'));
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
  // Windows can release the process handle before its listening socket disappears.
  // Wait for our two ports to drain; never kill a replacement/unrecognized process.
  for (let count = 0; count < 40; count++) {
    if (!(await portBusy(4280)) && !(await portBusy(4281))) break;
    await pause(100);
  }
  if ((await portBusy(4280)) || (await portBusy(4281)))
    throw new Error('Ports remain occupied after shutdown. No unrecognized process was modified.');
  writeFileSync(paths.processes, JSON.stringify({ root, processes: [] }, null, 2) + '\n');
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
const running = (paths) =>
  existsSync(paths.processes) &&
  JSON.parse(readFileSync(paths.processes, 'utf8')).processes.some((item) => alive(item.pid));
async function up(paths = ownerState, build = true) {
  const config = runtime(paths);
  if (existsSync(paths.processes)) {
    const record = JSON.parse(readFileSync(paths.processes, 'utf8'));
    const living = record.processes.filter((item) => alive(item.pid));
    if (living.length) {
      if (living.length === 2 && living.every(owned)) {
        const response = await fetch('http://127.0.0.1:4280/api/status').catch(() => null);
        if (response?.ok && response.headers.get('x-cleardesk-instance') === config.instanceId) {
          console.log('ClearDesk is already running at http://127.0.0.1:4280');
          return;
        }
      }
      throw new Error('A partial recorded instance exists. Run npm run stop before restarting.');
    }
  }
  if ((await portBusy(4280)) || (await portBusy(4281)))
    throw new Error('A required port is occupied. No existing process was modified.');
  if (!existsSync(python) || !existsSync(paths.accounts))
    throw new Error('Run npm run bootstrap first.');
  const demoState = JSON.parse(readFileSync(paths.accounts, 'utf8'));
  if (demoState.phase && demoState.phase !== 'COMPLETE')
    throw new Error('Demo initialization is incomplete. Run npm run bootstrap to resume it.');
  if (build) npm(['run', 'build']);
  mkdirSync(paths.delivery, { recursive: true });
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
    const log = openSync(join(paths.delivery, item.kind + '-server.log'), 'a');
    const child = spawn(item.executable, item.args, {
      cwd: item.cwd,
      env: { ...childEnvironment(), ...stateEnvironment(paths), NODE_ENV: 'production' },
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
    });
    closeSync(log);
    if (!child.pid) throw new Error('Unable to start the owned ' + item.kind + ' service.');
    record.processes.push({ kind: item.kind, pid: child.pid });
    writeFileSync(paths.processes, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    child.unref();
  }
  for (let count = 0; count < 120; count++) {
    const response = await fetch('http://127.0.0.1:4280/api/status', {
      signal: AbortSignal.timeout(1000),
    }).catch(() => null);
    if (response?.ok && response.headers.get('x-cleardesk-instance') === config.instanceId) {
      console.log('ClearDesk is ready at http://127.0.0.1:4280 (' + config.mode + ' mode).');
      return;
    }
    if (record.processes.some((item) => !alive(item.pid))) break;
    await pause(250);
  }
  await stop(paths);
  throw new Error('ClearDesk did not become ready. Review the private service logs.');
}

function bootstrap() {
  if (running(ownerState))
    throw new Error('ClearDesk is running. Run npm run stop before bootstrapping.');
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
  run(python, ['scripts/seed_demo.py'], root, stateEnvironment(ownerState));
  npm(['run', 'build']);
  console.log(
    'Bootstrap complete. Generated demo passwords are in ' +
      ownerState.accounts.slice(root.length).replaceAll('\\', '/') +
      '.',
  );
}

/**
 * Offline acceptance never runs against the owner's demo data. Each run seeds a fresh synthetic
 * state in .local/acceptance/<run>, exercises it on the usual ports, keeps it for inspection and
 * then restarts the owner's instance, if it was running, in its own unchanged mode.
 */
async function validate() {
  if (ownerState.value)
    throw new Error('Run acceptance from the owner state, not an isolated one.');
  run(process.execPath, ['scripts/cleardesk.mjs', 'verify']);
  const ownerWasRunning = running(ownerState);
  const name =
    new Date().toISOString().replaceAll(/[:.]/g, '-') + '-' + randomBytes(3).toString('hex');
  const acceptance = statePaths('.local/acceptance/' + name);
  mkdirSync(dirname(acceptance.runtime), { recursive: true });
  if (runtime(acceptance).mode !== 'fixture')
    throw new Error('Acceptance state must use fixtures.');
  const environment = stateEnvironment(acceptance);
  run(python, ['scripts/seed_demo.py'], root, environment);
  await stop(ownerState);
  let failure = null;
  try {
    await up(acceptance, false);
    run(python, ['verification/retrieval_eval.py']);
    run(process.execPath, ['--import', 'tsx', 'verification/rehearse.ts'], root, environment);
    npm(['run', 'test:browser'], environment);
  } catch (error) {
    failure = error;
  }
  try {
    await stop(acceptance);
  } finally {
    if (ownerWasRunning) await up(ownerState, false);
  }
  if (failure) throw failure;
  console.log(
    'Local acceptance completed in an isolated fixture state (' +
      name +
      '); fresh reports are under artifacts/runs.',
  );
}

try {
  const command = process.argv[2];
  if (command === 'bootstrap') bootstrap();
  else if (command === 'demo') {
    if (running(ownerState)) await up();
    else {
      bootstrap();
      await up(ownerState, false);
    }
  } else if (command === 'validate') await validate();
  else if (command === 'up') await up();
  else if (command === 'stop') await stop();
  else if (command === 'verify') {
    npm(['run', 'format:check']);
    npm(['run', 'typecheck']);
    npm(['test']);
    run(python, [
      '-m',
      'ruff',
      'check',
      'services/knowledge/cleardesk',
      'services/knowledge/tests',
      'scripts',
      'verification',
    ]);
    run(python, [
      '-m',
      'ruff',
      'format',
      '--check',
      'services/knowledge/cleardesk',
      'services/knowledge/tests',
      'scripts',
      'verification',
    ]);
    run(python, ['-m', 'pytest', '-q'], join(root, 'services/knowledge'));
    npm(['run', 'build']);
    run(process.execPath, ['scripts/scan-secrets.mjs']);
  } else if (command === 'mode' || command === 'live-smoke') {
    const mode = command === 'live-smoke' ? 'live' : process.argv[3];
    if (!['fixture', 'live'].includes(mode)) throw new Error('Choose fixture or live mode.');
    await stop();
    const configuration = runtime();
    writeFileSync(ownerState.runtime, JSON.stringify({ ...configuration, mode }, null, 2) + '\n', {
      mode: 0o600,
    });
    await up();
    if (command === 'live-smoke')
      npm(['run', 'test:browser', '--', '--grep', 'bounded-live-browser'], {
        ...stateEnvironment(ownerState),
        CLEARDESK_LIVE_BROWSER: '1',
      });
  } else if (command === 'rehearse')
    run(
      process.execPath,
      ['--import', 'tsx', 'verification/rehearse.ts'],
      root,
      stateEnvironment(ownerState),
    );
  else if (command === 'retrieval') run(python, ['verification/retrieval_eval.py']);
  else throw new Error('Use bootstrap, up, stop, verify, rehearse, mode or live-smoke.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'ClearDesk command failed.');
  process.exitCode = 1;
}
