import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

const HOST = '0.0.0.0';
const DEFAULT_PORT = 5173;
const ROOT_DIR = process.cwd();

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

const rawPort = process.env.PORT;
const parsedPort = rawPort ? Number.parseInt(rawPort, 10) : DEFAULT_PORT;

if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
  console.error(`Invalid PORT value: ${rawPort}`);
  console.error(`Use a number between 1 and 65535, for example: PORT=${DEFAULT_PORT} npm run dev`);
  process.exit(1);
}

const port = parsedPort;

function getContentType(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function getLanAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const networkEntries of Object.values(interfaces)) {
    if (!networkEntries) {
      continue;
    }

    for (const entry of networkEntries) {
      const isIPv4 = entry.family === 'IPv4' || entry.family === 4;

      if (isIPv4 && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return [...new Set(addresses)];
}

function setCommonHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
}

function sendResponse(res, statusCode, body, extraHeaders = {}) {
  setCommonHeaders(res);

  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value);
  }

  res.statusCode = statusCode;
  res.end(body);
}

function resolveRequestPath(requestUrl) {
  const rawPath = (requestUrl || '/').split('?')[0].split('#')[0] || '/';
  const decodedPath = decodeURIComponent(rawPath);
  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath;
  const absolutePath = path.resolve(ROOT_DIR, `.${requestedPath}`);
  const relativePath = path.relative(ROOT_DIR, absolutePath);

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

async function handleRequest(req, res) {
  const method = req.method || 'GET';

  if (method !== 'GET' && method !== 'HEAD') {
    sendResponse(res, 405, 'Method Not Allowed', {
      'Content-Type': 'text/plain; charset=utf-8',
      Allow: 'GET, HEAD',
    });
    return;
  }

  let filePath;

  try {
    filePath = resolveRequestPath(req.url || '/');
  } catch {
    sendResponse(res, 400, 'Bad Request', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return;
  }

  if (!filePath) {
    sendResponse(res, 403, 'Forbidden', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return;
  }

  let stats;

  try {
    stats = await fs.promises.stat(filePath);

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      stats = await fs.promises.stat(indexPath);
      filePath = indexPath;
    }
  } catch {
    sendResponse(res, 404, 'Not Found', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return;
  }

  if (!stats.isFile()) {
    sendResponse(res, 404, 'Not Found', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return;
  }

  setCommonHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', getContentType(filePath));
  res.setHeader('Content-Length', stats.size);

  if (method === 'HEAD') {
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);

  stream.on('error', () => {
    if (!res.headersSent) {
      sendResponse(res, 500, 'Internal Server Error', {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      return;
    }

    res.destroy();
  });

  stream.pipe(res);
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    sendResponse(res, 500, 'Internal Server Error', {
      'Content-Type': 'text/plain; charset=utf-8',
    });
  });
});

server.on('error', (error) => {
  if (error && error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use.`);
    console.error('Resolve it by stopping the existing process or choosing another port.');
    console.error(`Try: PORT=${port + 1} npm run dev`);
    console.error(`On macOS/Linux, you can inspect the port with: lsof -i :${port}`);
    process.exit(1);
  }

  console.error('Failed to start dev server.');
  console.error(error);
  process.exit(1);
});

server.listen(port, HOST, () => {
  console.log('Native dev server running');
  console.log(`Local: http://localhost:${port}`);

  const lanAddresses = getLanAddresses();

  if (lanAddresses.length > 0) {
    for (const address of lanAddresses) {
      console.log(`LAN:   http://${address}:${port}`);
    }
  } else {
    console.log('LAN:   No external IPv4 address detected');
  }
});
