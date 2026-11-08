#!/usr/bin/env node
// Zero-dependency local server: serves the UI, reads books/, reads and writes progress/.
const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = process.env.PORT || 3000;
const BOOKS = path.join(__dirname, 'books');
const PROGRESS = path.join(__dirname, 'progress');
const PUBLIC = path.join(__dirname, 'public');
const MAX_BODY = 5 * 1024 * 1024;
const STATIC = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/style.css': ['style.css', 'text/css'],
};

// Returns a message describing the first problem, or null if the book is usable.
function validateBook(book) {
  if (typeof book?.title !== 'string') return 'missing "title"';
  if (!Array.isArray(book.chapters) || !book.chapters.length) return 'missing "chapters"';
  for (const ch of book.chapters) {
    if (typeof ch.title !== 'string') return 'a chapter is missing "title"';
    if (!Array.isArray(ch.sections) || !ch.sections.length) return `"${ch.title}" has no "sections"`;
    for (const sec of ch.sections) {
      const where = `"${ch.title} / ${sec.title}"`;
      if (typeof sec.title !== 'string') return `a section in "${ch.title}" is missing "title"`;
      if (!Array.isArray(sec.text)) return `${where}: "text" must be a list of paragraphs`;
      sec.questions ??= [];
      for (const q of sec.questions) {
        const problem = validateQuestion(q);
        if (problem) return `${where}: ${problem}`;
      }
    }
  }
  return null;
}

function validateQuestion(q) {
  if (typeof q.q !== 'string') return 'a question is missing "q"';
  const inRange = (i) => Number.isInteger(i) && i >= 0 && i < q.options.length;
  switch (q.type) {
    case 'fill':
      return [].concat(q.answer).every((a) => typeof a === 'string' && a.trim()) && q.answer?.length
        ? null : `"${q.q}": fill "answer" must be text or a list of text`;
    case 'single':
    case 'dropdown':
    case 'multiple': {
      if (!Array.isArray(q.options) || q.options.length < 2) return `"${q.q}": needs at least 2 "options"`;
      const ok = q.type === 'multiple'
        ? Array.isArray(q.answer) && q.answer.length && q.answer.every(inRange)
        : inRange(q.answer);
      return ok ? null : `"${q.q}": "answer" must point at "options" by position, starting from 0`;
    }
    default:
      return `"${q.q}": unknown type "${q.type}"`;
  }
}

async function jsonFiles(dir) {
  const names = await fs.readdir(dir);
  return names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5));
}

async function loadBooks() {
  const ids = (await jsonFiles(BOOKS)).filter((id) => !id.startsWith('_')).sort();
  return Promise.all(ids.map(async (id) => {
    try {
      const book = JSON.parse(await fs.readFile(path.join(BOOKS, `${id}.json`), 'utf8'));
      const error = validateBook(book);
      return error ? { id, error } : { ...book, id };
    } catch (err) {
      return { id, error: err.message };
    }
  }));
}

async function loadProgress() {
  const out = Object.create(null);
  for (const name of await jsonFiles(PROGRESS)) {
    const raw = await fs.readFile(path.join(PROGRESS, `${name}.json`), 'utf8');
    try {
      out[name] = JSON.parse(raw);
    } catch (err) {
      // Fail loudly: treating this as empty would let the next save overwrite the file.
      throw new Error(`progress/${name}.json is not valid JSON: ${err.message}`);
    }
  }
  return out;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Write-then-rename, so a crash mid-save can't leave a half-written progress file.
async function saveProgress(name, data) {
  const file = path.join(PROGRESS, `${name}.json`);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fs.rename(tmp, file);
}

const send = (res, status, body, type = 'application/json') => {
  res.writeHead(status, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

async function handle(req, res) {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (req.method === 'GET' && STATIC[pathname]) {
    const [file, type] = STATIC[pathname];
    return send(res, 200, await fs.readFile(path.join(PUBLIC, file)), type);
  }
  if (req.method === 'GET' && pathname === '/api/books') return send(res, 200, await loadBooks());
  if (req.method === 'GET' && pathname === '/api/progress') return send(res, 200, await loadProgress());

  // The strict name pattern is what keeps writes inside progress/.
  const match = pathname.match(/^\/api\/progress\/([\w-]+)$/);
  if (req.method === 'PUT' && match) {
    let data;
    try {
      data = JSON.parse(await readBody(req));
    } catch (err) {
      return send(res, err.status || 400, { error: err.message });
    }
    if (data === null || typeof data !== 'object') return send(res, 400, { error: 'Expected an object' });
    await saveProgress(match[1], data);
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Not found' });
}

async function main() {
  await fs.mkdir(BOOKS, { recursive: true });
  await fs.mkdir(PROGRESS, { recursive: true });

  if (process.argv.includes('--check')) {
    const books = await loadBooks();
    for (const b of books) console.log(b.error ? `FAIL ${b.id}: ${b.error}` : `ok   ${b.id}`);
    process.exit(books.some((b) => b.error) ? 1 : 0);
  }

  http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      send(res, 500, { error: err.message });
    });
  }).listen(PORT, '127.0.0.1', () => console.log(`Book learning: http://localhost:${PORT}`));
}

main();
