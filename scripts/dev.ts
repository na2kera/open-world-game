import { spawn, type ChildProcess } from 'node:child_process';

const children: ChildProcess[] = [];

function start(args: string[]): ChildProcess {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code) => {
    if (code && code !== 0) stop(code);
  });
  return child;
}

function stop(code = 0): void {
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start(['--import', 'tsx', 'server/index.ts']);
start(['node_modules/vite/bin/vite.js']);
