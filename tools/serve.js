// 本机预览用的静态服务器。不带依赖。
//   node tools/serve.js [--port 4173] [--host] [--dir dist]
// 不带 --host 只听 127.0.0.1；带了听所有网卡，同一局域网的手机也能打开。

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.md': 'text/plain; charset=utf-8',
};

function parseArgs(argv) {
  const args = { port: 4173, host: false, dir: 'dist' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--host') args.host = true;
  }
  return args;
}

export function startServer({ port = 4173, host = false, dir = 'dist' } = {}) {
  const base = path.resolve(ROOT, dir);
  const server = createServer((req, res) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end('bad request');
      return;
    }
    let file = path.join(base, pathname);
    if (file !== base && !file.startsWith(base + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host ? '0.0.0.0' : '127.0.0.1', () => resolve(server));
  });
}

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => item.address);
}

function isMain() {
  if (!process.argv[1]) return false;
  const here = fileURLToPath(import.meta.url);
  const entry = path.resolve(process.argv[1]);
  return process.platform === 'win32' ? here.toLowerCase() === entry.toLowerCase() : here === entry;
}

if (isMain()) {
  const args = parseArgs(process.argv.slice(2));
  const server = await startServer(args);
  const { port } = server.address();
  console.log(`预览：http://127.0.0.1:${port}/`);
  if (args.host) for (const address of lanAddresses()) console.log(`局域网：http://${address}:${port}/`);
}
