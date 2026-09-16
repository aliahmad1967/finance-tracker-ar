const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'finance.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    description TEXT NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const defaultSettings = {
  currency: 'د.ع',
  monthlyTarget: '0',
  theme: 'light',
  lastMonth: '',
};

function ensureSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const current = Object.fromEntries(rows.map((row) => [row.key, row.value]));
  for (const [key, value] of Object.entries(defaultSettings)) {
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, String(value));
    }
  }
}

ensureSettings();

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const result = { ...defaultSettings };
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

function saveSettings(payload = {}) {
  const current = getSettings();
  const next = { ...current, ...payload };
  const statement = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const [key, value] of Object.entries(next)) {
    statement.run(key, String(value));
  }
  return getSettings();
}

function normalizeDate(dateString) {
  if (!dateString) {
    return new Date().toISOString().slice(0, 10);
  }
  const parsed = new Date(dateString + 'T00:00:00');
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function getTransactionsByMonth(month) {
  const monthValue = month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT id, description, amount, type, category, date
    FROM transactions
    WHERE substr(date, 1, 7) = ?
    ORDER BY date DESC, id DESC
  `).all(monthValue);

  return rows.map((row) => ({
    ...row,
    amount: Number(row.amount),
  }));
}

function getAllTransactions() {
  return db.prepare(`
    SELECT id, description, amount, type, category, date
    FROM transactions
    ORDER BY date DESC, id DESC
  `).all().map((row) => ({ ...row, amount: Number(row.amount) }));
}

function upsertTransaction(transaction) {
  const cleaned = {
    description: String(transaction.description || '').trim(),
    amount: Number(transaction.amount),
    type: transaction.type === 'income' ? 'income' : 'expense',
    category: transaction.category || 'food',
    date: normalizeDate(transaction.date),
  };

  if (!cleaned.description || !Number.isFinite(cleaned.amount) || cleaned.amount <= 0) {
    const error = new Error('Invalid transaction data');
    error.code = 'INVALID_TRANSACTION';
    throw error;
  }

  const result = db.prepare(`
    INSERT INTO transactions (description, amount, type, category, date)
    VALUES (?, ?, ?, ?, ?)
  `).run(cleaned.description, cleaned.amount, cleaned.type, cleaned.category, cleaned.date);

  return getTransactionById(result.lastInsertRowid);
}

function updateTransaction(id, transaction) {
  const existing = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!existing) {
    const error = new Error('Transaction not found');
    error.code = 'NOT_FOUND';
    throw error;
  }

  const cleaned = {
    description: String(transaction.description || existing.description).trim(),
    amount: Number(transaction.amount ?? existing.amount),
    type: transaction.type === 'income' ? 'income' : 'expense',
    category: transaction.category || existing.category,
    date: normalizeDate(transaction.date || existing.date),
  };

  if (!cleaned.description || !Number.isFinite(cleaned.amount) || cleaned.amount <= 0) {
    const error = new Error('Invalid transaction data');
    error.code = 'INVALID_TRANSACTION';
    throw error;
  }

  db.prepare(`
    UPDATE transactions
    SET description = ?, amount = ?, type = ?, category = ?, date = ?
    WHERE id = ?
  `).run(cleaned.description, cleaned.amount, cleaned.type, cleaned.category, cleaned.date, id);

  return getTransactionById(id);
}

function deleteTransaction(id) {
  const result = db.prepare('DELETE FROM transactions WHERE id = ?').run(id);
  return result.changes > 0;
}

function getTransactionById(id) {
  const row = db.prepare('SELECT * FROM transactions WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, amount: Number(row.amount) };
}

function getSummaryForMonth(month) {
  const transactions = getTransactionsByMonth(month);
  const income = transactions.filter((row) => row.type === 'income').reduce((sum, row) => sum + row.amount, 0);
  const expenses = transactions.filter((row) => row.type === 'expense').reduce((sum, row) => sum + row.amount, 0);
  const pie = {};
  for (const row of transactions) {
    if (row.type === 'expense') {
      pie[row.category] = (pie[row.category] || 0) + row.amount;
    }
  }

  return {
    income,
    expenses,
    net: income - expenses,
    transactions,
    breakdown: pie,
  };
}

module.exports = {
  db,
  getSettings,
  saveSettings,
  getTransactionsByMonth,
  getAllTransactions,
  upsertTransaction,
  updateTransaction,
  deleteTransaction,
  getSummaryForMonth,
};
