import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { AiError, DEFAULT_MODEL, analyzeWithAi } from './ai.js';
import { SplitwiseError, importFromSplitwise, makeClient } from './splitwise.js';
import { ValidationError, netBalances, simplifyDebts } from './money.js';
import { CATEGORIES, normalizeExpense, normalizePerson } from './ledger.js';
import {
  MAX_FILE_BYTES, MAX_RECEIPTS_PER_EXPENSE, RECEIPT_FILE_RE, mimeForFile,
  removeReceiptFiles, saveReceipts, uploadMiddleware,
} from './receipts.js';

const srcDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Optional shared password (HTTP Basic, any username) for LAN / hosted use.
function basicAuth(password) {
  return (req, res, next) => {
    if (!password) return next();
    const header = req.headers.authorization || '';
    if (header.startsWith('Basic ')) {
      const decoded = Buffer.from(header.slice(6), 'base64').toString();
      const pass = decoded.slice(decoded.indexOf(':') + 1);
      if (safeEqual(pass, password)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Roommate Ledger"');
    return res.status(401).send('Authentication required');
  };
}

export async function createApp({ dataDir, password = '', splitwiseKey = '', anthropicKey = '', anthropicModel = '', fetchImpl = fetch } = {}) {
  const store = await new Store(dataDir).init();
  const app = express();
  app.disable('x-powered-by');
  app.set('store', store);
  app.use(basicAuth(password));
  app.use(express.json({ limit: '1mb' }));

  const data = () => store.data;
  const publicExpense = (e) => ({ ...e });

  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

  // ---- Settings -----------------------------------------------------------
  app.get('/api/settings', (req, res) => res.json({ ...data().settings, categories: CATEGORIES }));

  app.put('/api/settings', wrap(async (req, res) => {
    const { householdName, currency } = req.body || {};
    const settings = await store.mutate((d) => {
      if (householdName !== undefined) {
        const n = String(householdName).trim();
        if (!n || n.length > 60) throw new ValidationError('Household name must be 1-60 characters');
        d.settings.householdName = n;
      }
      if (currency !== undefined) {
        const c = String(currency).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(c)) throw new ValidationError('Currency must be a 3-letter code, e.g. USD');
        d.settings.currency = c;
      }
      return d.settings;
    });
    res.json({ ...settings, categories: CATEGORIES });
  }));

  // ---- People -------------------------------------------------------------
  app.get('/api/people', (req, res) => res.json({ people: data().people }));

  app.post('/api/people', wrap(async (req, res) => {
    const person = await store.mutate((d) => {
      const p = normalizePerson(req.body || {});
      if (d.people.some((x) => x.active && x.name.toLowerCase() === p.name.toLowerCase())) {
        throw new ValidationError(`${p.name} already exists`);
      }
      d.people.push(p);
      return p;
    });
    res.status(201).json({ person });
  }));

  app.patch('/api/people/:id', wrap(async (req, res) => {
    const person = await store.mutate((d) => {
      const i = d.people.findIndex((p) => p.id === req.params.id);
      if (i < 0) throw notFound('Person');
      d.people[i] = normalizePerson(req.body || {}, d.people[i]);
      return d.people[i];
    });
    res.json({ person });
  }));

  // Deleting someone who appears in the ledger archives them so history stays intact.
  app.delete('/api/people/:id', wrap(async (req, res) => {
    const result = await store.mutate((d) => {
      const i = d.people.findIndex((p) => p.id === req.params.id);
      if (i < 0) throw notFound('Person');
      const id = req.params.id;
      const used = d.expenses.some((e) => e.paidBy.some((x) => x.personId === id) || e.splits.some((x) => x.personId === id));
      if (used) {
        d.people[i].active = false;
        return { archived: true };
      }
      d.people.splice(i, 1);
      return { deleted: true };
    });
    res.json(result);
  }));

  // ---- Expenses -----------------------------------------------------------
  app.get('/api/expenses', (req, res) => {
    const { search = '', person = '', category = '', type = '', from = '', to = '' } = req.query;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 200);
    const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
    const q = String(search).toLowerCase();
    let list = data().expenses.filter((e) => {
      if (q && !`${e.description} ${e.notes} ${e.category}`.toLowerCase().includes(q)) return false;
      if (person && !e.paidBy.some((x) => x.personId === person) && !e.splits.some((x) => x.personId === person)) return false;
      if (category && e.category !== category) return false;
      if (type && e.type !== type) return false;
      if (from && e.date < from) return false;
      if (to && e.date > to) return false;
      return true;
    });
    list.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
    const total = list.length;
    list = list.slice(offset, offset + limit);
    res.json({ expenses: list.map(publicExpense), total, limit, offset });
  });

  app.get('/api/expenses/:id', (req, res) => {
    const e = data().expenses.find((x) => x.id === req.params.id);
    if (!e) throw notFound('Expense');
    res.json({ expense: publicExpense(e) });
  });

  app.post('/api/expenses', wrap(async (req, res) => {
    const expense = await store.mutate((d) => {
      const e = normalizeExpense(req.body || {}, d.people);
      d.expenses.push(e);
      return e;
    });
    res.status(201).json({ expense: publicExpense(expense) });
  }));

  app.put('/api/expenses/:id', wrap(async (req, res) => {
    const expense = await store.mutate((d) => {
      const i = d.expenses.findIndex((x) => x.id === req.params.id);
      if (i < 0) throw notFound('Expense');
      d.expenses[i] = normalizeExpense(req.body || {}, d.people, d.expenses[i]);
      return d.expenses[i];
    });
    res.json({ expense: publicExpense(expense) });
  }));

  app.delete('/api/expenses/:id', wrap(async (req, res) => {
    const removed = await store.mutate((d) => {
      const i = d.expenses.findIndex((x) => x.id === req.params.id);
      if (i < 0) throw notFound('Expense');
      return d.expenses.splice(i, 1)[0];
    });
    await removeReceiptFiles(store.receiptsDir, removed.receipts || []);
    res.json({ deleted: true });
  }));

  // ---- Receipts (images / PDF) ---------------------------------------------
  const upload = (req, res, next) => uploadMiddleware(req, res, next);

  app.post('/api/expenses/:id/receipts', upload, wrap(async (req, res) => {
    const files = req.files || [];
    if (files.length === 0) throw new ValidationError('No file received. Attach one or more files in the "receipts" field.');
    const exists = data().expenses.find((x) => x.id === req.params.id);
    if (!exists) throw notFound('Expense');
    if ((exists.receipts || []).length + files.length > MAX_RECEIPTS_PER_EXPENSE) {
      throw new ValidationError(`An expense can have at most ${MAX_RECEIPTS_PER_EXPENSE} receipts`);
    }
    const saved = await saveReceipts(store.receiptsDir, files);
    try {
      const expense = await store.mutate((d) => {
        const e = d.expenses.find((x) => x.id === req.params.id);
        if (!e) throw notFound('Expense');
        e.receipts = [...(e.receipts || []), ...saved];
        e.updatedAt = new Date().toISOString();
        return e;
      });
      res.status(201).json({ expense: publicExpense(expense), added: saved });
    } catch (err) {
      await removeReceiptFiles(store.receiptsDir, saved);
      throw err;
    }
  }));

  app.delete('/api/expenses/:id/receipts/:receiptId', wrap(async (req, res) => {
    const removed = await store.mutate((d) => {
      const e = d.expenses.find((x) => x.id === req.params.id);
      if (!e) throw notFound('Expense');
      const i = (e.receipts || []).findIndex((r) => r.id === req.params.receiptId);
      if (i < 0) throw notFound('Receipt');
      e.updatedAt = new Date().toISOString();
      return e.receipts.splice(i, 1)[0];
    });
    await removeReceiptFiles(store.receiptsDir, [removed]);
    res.json({ deleted: true });
  }));

  app.get('/api/receipts/:file', (req, res) => {
    const { file } = req.params;
    if (!RECEIPT_FILE_RE.test(file)) throw notFound('Receipt');
    const meta = data().expenses.flatMap((e) => e.receipts || []).find((r) => r.file === file);
    res.set({
      'Content-Type': mimeForFile(file),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=86400',
      'Content-Disposition': `inline; filename="${(meta?.name || file).replace(/"/g, '')}"`,
    });
    res.sendFile(file, { root: store.receiptsDir }, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not_found', message: 'Receipt not found' });
    });
  });

  // ---- Balances -----------------------------------------------------------
  app.get('/api/balances', (req, res) => {
    const d = data();
    const net = netBalances(d.expenses, d.people.map((p) => p.id));
    res.json({
      currency: d.settings.currency,
      net,
      transfers: simplifyDebts(net),
    });
  });

  // ---- AI receipt reading (optional, off unless a key is configured) ----------
  app.get('/api/capabilities', (req, res) => res.json({ ai: !!anthropicKey, aiModel: anthropicKey ? (anthropicModel || DEFAULT_MODEL) : null }));

  app.post('/api/receipts/analyze', (req, res, next) => uploadMiddleware(req, res, next), wrap(async (req, res) => {
    if (!anthropicKey) throw Object.assign(new Error('AI receipt reading is not enabled on this server.'), { status: 404 });
    const file = (req.files || [])[0];
    if (!file) throw new ValidationError('Attach a receipt in the "receipts" field.');
    try {
      const result = await analyzeWithAi({ apiKey: anthropicKey, model: anthropicModel || DEFAULT_MODEL, buffer: file.buffer, categories: CATEGORIES, fetchImpl });
      res.json({ result });
    } catch (err) {
      if (err instanceof AiError) return res.status(err.status).json({ error: 'ai_error', message: err.message });
      throw err;
    }
  }));

  // ---- Splitwise (optional) -------------------------------------------------
  // Never required: failures here are reported, but the rest of the app is unaffected.
  const swToken = (req) => String(req.headers['x-splitwise-token'] || splitwiseKey || '').trim();

  app.get('/api/splitwise/status', wrap(async (req, res) => {
    const token = swToken(req);
    if (!token) return res.json({ configured: false, connected: false, serverKey: false });
    try {
      const { user } = await makeClient(token, fetchImpl)('get_current_user');
      res.json({ configured: true, connected: true, serverKey: !!splitwiseKey && !req.headers['x-splitwise-token'], user: { name: [user.first_name, user.last_name].filter(Boolean).join(' '), email: user.email } });
    } catch (err) {
      if (!(err instanceof SplitwiseError)) throw err;
      res.json({ configured: true, connected: false, error: err.message });
    }
  }));

  app.post('/api/splitwise/import', wrap(async (req, res) => {
    const token = swToken(req);
    if (!token) throw Object.assign(new Error('No Splitwise API key configured. Add one in Settings.'), { status: 400 });
    try {
      res.json({ summary: await importFromSplitwise(store, token, fetchImpl) });
    } catch (err) {
      if (err instanceof SplitwiseError) return res.status(err.status).json({ error: 'splitwise_error', message: err.message });
      throw err;
    }
  }));

  // ---- Exports --------------------------------------------------------------
  const csvCell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formulas
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  app.get('/api/export/expenses.csv', (req, res) => {
    const d = data();
    const name = (id) => d.people.find((p) => p.id === id)?.name || id;
    const rows = [['Date', 'Type', 'Description', 'Category', 'Amount', 'Currency', 'Paid by', 'Split between', 'Notes', 'Receipts']];
    [...d.expenses].sort((a, b) => a.date.localeCompare(b.date)).forEach((e) => rows.push([
      e.date, e.type, e.description, e.category, (e.amountCents / 100).toFixed(2), d.settings.currency,
      e.paidBy.map((p) => `${name(p.personId)} ${(p.cents / 100).toFixed(2)}`).join('; '),
      e.splits.map((s) => `${name(s.personId)} ${(s.cents / 100).toFixed(2)}`).join('; '),
      e.notes, (e.receipts || []).length,
    ]));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="expenses.csv"' });
    res.send(`\uFEFF${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`);
  });

  app.get('/api/export/ledger.json', (req, res) => {
    res.set({ 'Content-Disposition': 'attachment; filename="ledger.json"' });
    res.json(data());
  });

  // The browser reuses the exact split maths the server uses, so previews can never disagree with saved results.
  app.get('/shared/money.js', (req, res) => res.type('js').sendFile(path.join(srcDir, 'money.js')));

  // ---- Static UI + errors -------------------------------------------------
  app.use(express.static(publicDir));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown API route' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_request', message: 'Request body is not valid JSON' });
    }
    if (err.name === 'MulterError') {
      const message = err.code === 'LIMIT_FILE_SIZE'
        ? `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB each)`
        : err.code === 'LIMIT_UNEXPECTED_FILE' || err.code === 'LIMIT_FILE_COUNT'
          ? `Too many files (max ${MAX_RECEIPTS_PER_EXPENSE})`
          : err.message;
      return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'bad_request', message });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'server_error' : 'bad_request', message: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
