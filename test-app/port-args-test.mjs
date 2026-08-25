import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const BIN = join(import.meta.dirname, 'node_modules', '.bin', 'vesk');
let failures = 0;
let running = [];

function fail(msg) {
  failures++;
  console.error(`FAIL: ${msg}`);
}

async function waitPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.status === 200) return true;
    } catch {}
    await new Promise((res) => setTimeout(res, 1500));
  }
  return false;
}

function killAll() {
  for (const [pid, guard] of running) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

function spawnHaul(args) {
  const child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: import.meta.dirname });
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  running.push([child.pid, args[0]]);
  return { child, getLog: () => log };
}

const startBare = spawnHaul(['start', '3994']);
const okBare = await waitPort(3994, 90000);
if (!okBare) fail(`vesk start 3994 (bare positional port) never served — log:\n${startBare.getLog()}`);
else console.log('ok: vesk start 3994 (bare positional port)');
killAll(); running = [];

const startEquals = spawnHaul(['start', '--port=3992']);
const okEquals = await waitPort(3992, 90000);
if (!okEquals) fail(`vesk start --port=3992 never served — log:\n${startEquals.getLog()}`);
else console.log('ok: vesk start --port=3992 (equals form)');
killAll(); running = [];

const npmRun = spawn('npm', ['run', 'dev', '-p', '3991'], { stdio: ['ignore', 'pipe', 'pipe'], cwd: import.meta.dirname });
let npmLog = '';
npmRun.stdout.on('data', (d) => (npmLog += d));
npmRun.stderr.on('data', (d) => (npmLog += d));
running.push([npmRun.pid, 'npm']);
const okNpm = await waitPort(3991, 120000);
if (!okNpm) fail(`npm run dev -p 3991 (npm eats -p, bare port passed) never served — log:\n${npmLog}`);
else console.log('ok: npm run dev -p 3991 (positional pass-through)');
killAll(); running = [];

const badArg = spawnHaul(['start', '--bogus']);
const badOut = await new Promise((resolve) => {
  badArg.child.on('exit', (code) => resolve({ code, log: badArg.getLog() }));
  setTimeout(() => { killAll(); resolve({ code: -1, log: badArg.getLog() }); }, 15000);
});
if (badOut.code === 0 || !badOut.log.includes('unexpected argument')) {
  fail(`vesk start --bogus should error with 'unexpected argument' (exit=${badOut.code}) — log:\n${badOut.log}`);
} else {
  console.log('ok: vesk start --bogus rejected with unexpected argument');
}
killAll(); running = [];

console.log(failures === 0 ? '\nPORT-ARGS: all tests passed' : `\nPORT-ARGS: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
