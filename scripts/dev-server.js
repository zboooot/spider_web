#!/usr/bin/env node
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const PORT = parseInt(process.env.PORT ?? '5173', 10);
const HOST = '0.0.0.0';
const ROOT = path.resolve(process.cwd());

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.mp3':  'audio/mpeg',
};

function getLanAddress() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return null;
}

function send(res, statusCode, headers, body) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function sendError(res, statusCode, message) {
  send(res, statusCode, { 'Content-Type': 'text/plain; charset=utf-8' }, message);
}

function handler(req, res) {
  const method = req.method?.toUpperCase();

  if (method !== 'GET' && method !== 'HEAD') {
    sendError(res, 405, '405 Method Not Allowed');
    return;
  }

  let urlPath;
  try {
    urlPath = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
  } catch {
    sendError(res, 400, '400 Bad Request');
    return;
  }

  try {
    urlPath = decodeURIComponent(urlPath);
  } catch {
    sendError(res, 400, '400 Bad Request — malformed URI');
    return;
  }

  if (urlPath === '/' || urlPath === '') {
    urlPath = '/index.html';
  }

  const absPath = path.resolve(ROOT, '.' + urlPath);

  // Security: path.resolve collapses ".." segments — block anything that escapes ROOT
  if (!absPath.startsWith(ROOT + path.sep) && absPath !== ROOT) {
    sendError(res, 403, '403 Forbidden — path traversal detected');
    return;
  }

  fs.stat(absPath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      sendError(res, 404, `404 Not Found — ${urlPath}`);
      return;
    }

    const ext = path.extname(absPath).toLowerCase();
    const contentType = MIME[ext] ?? 'application/octet-stream';
    const headers = {
      'Content-Type':   contentType,
      'Content-Length': stat.size,
      'Cache-Control':  'no-store',
    };

    if (method === 'HEAD') {
      send(res, 200, headers, null);
      return;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(absPath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

const server = http.createServer(handler);

server.listen(PORT, HOST, () => {
  const lan = getLanAddress();
  const reset  = '\x1b[0m';
  const bold   = '\x1b[1m';
  const cyan   = '\x1b[36m';
  const green  = '\x1b[32m';
  const yellow = '\x1b[33m';

  console.log('');
  console.log(`  ${bold}${green}Dev Server${reset}  ${yellow}v1.0.0${reset}`);
  console.log('');
  console.log(`  ${bold}Local:${reset}   ${cyan}http://localhost:${PORT}/${reset}`);
  if (lan) {
    console.log(`  ${bold}LAN:${reset}     ${cyan}http://${lan}:${PORT}/${reset}`);
  } else {
    console.log(`  ${bold}LAN:${reset}     ${yellow}(no external interface found)${reset}`);
  }
  console.log('');
  console.log(`  Serving: ${ROOT}`);
  console.log(`  Press ${bold}Ctrl+C${reset} to stop.`);
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('');
    console.error(`  \x1b[31mError:\x1b[0m Port ${PORT} is already in use.`);
    console.error('');
    console.error('  To fix this, try one of the following:');
    console.error(`    • Kill the process using port ${PORT}:`);
    console.error(`        lsof -ti:${PORT} | xargs kill -9`);
    console.error(`    • Use a different port:`);
    console.error(`        PORT=3000 npm run dev`);
    console.error('');
    process.exit(1);
  } else {
    throw err;
  }
});
