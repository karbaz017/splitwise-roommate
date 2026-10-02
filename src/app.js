import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { ValidationError, netBalances, simplifyDebts } from './money.js';
import { CATEGORIES, normalizeExpense, normalizePerson } from './ledger.js';

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

export async function createApp({ dataDir, password = '' } = {}) {
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
    await store.mutate((d) => {
      const i = d.expenses.findIndex((x) => x.id === req.params.id);
      if (i < 0) throw notFound('Expense');
      d.expenses.splice(i, 1);
    });
    res.json({ deleted: true });
  }));

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

  // ---- Static UI + errors -------------------------------------------------
  app.use(express.static(publicDir));

  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown API route' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'bad_request', message: 'Request body is not valid JSON' });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'server_error' : 'bad_request', message: status >= 500 ? 'Internal server error' : err.message });
  });

  return app;
}
