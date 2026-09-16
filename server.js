const express = require('express');
const path = require('path');
const {
  getSettings,
  saveSettings,
  getTransactionsByMonth,
  upsertTransaction,
  updateTransaction,
  deleteTransaction,
  getSummaryForMonth,
} = require('./db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Finance tracker is running' });
});

app.get('/api/settings', (req, res) => {
  res.json(getSettings());
});

app.put('/api/settings', (req, res) => {
  res.json(saveSettings(req.body || {}));
});

app.get('/api/summary', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  res.json(getSummaryForMonth(month));
});

app.get('/api/transactions', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  res.json(getTransactionsByMonth(month));
});

app.post('/api/transactions', (req, res) => {
  try {
    const transaction = upsertTransaction(req.body || {});
    res.status(201).json(transaction);
  } catch (error) {
    const status = error.code === 'INVALID_TRANSACTION' ? 400 : 500;
    res.status(status).json({ message: error.message || 'Unable to create transaction' });
  }
});

app.put('/api/transactions/:id', (req, res) => {
  try {
    const transaction = updateTransaction(Number(req.params.id), req.body || {});
    res.json(transaction);
  } catch (error) {
    const status = error.code === 'NOT_FOUND' ? 404 : error.code === 'INVALID_TRANSACTION' ? 400 : 500;
    res.status(status).json({ message: error.message || 'Unable to update transaction' });
  }
});

app.delete('/api/transactions/:id', (req, res) => {
  const deleted = deleteTransaction(Number(req.params.id));
  if (!deleted) {
    return res.status(404).json({ message: 'Transaction not found' });
  }
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Finance tracker running at http://localhost:${port}`);
});
