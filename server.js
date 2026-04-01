// ============================================================
//  PlixTrade Pro v2  —  server.js
//  Complete backend: Auth, Trades, Wallet, Admin
// ============================================================
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'plixtrade_super_secret_2024';

// ── Database ─────────────────────────────────────────────────
const db = new Database(path.join(__dirname, 'plixtrade.db'));

db.exec(`
  PRAGMA journal_mode=WAL;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    UNIQUE NOT NULL,
    phone         TEXT,
    password_hash TEXT    NOT NULL,
    balance       REAL    DEFAULT 0,
    role          TEXT    DEFAULT 'user',
    status        TEXT    DEFAULT 'active',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS trades (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    pair         TEXT    NOT NULL,
    type         TEXT    NOT NULL,
    amount       REAL    NOT NULL,
    leverage     INTEGER DEFAULT 1,
    entry_price  REAL    NOT NULL,
    exit_price   REAL,
    profit_loss  REAL    DEFAULT 0,
    status       TEXT    DEFAULT 'open',
    note         TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    closed_at    DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS deposits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL,
    amount     REAL    NOT NULL,
    method     TEXT    DEFAULT 'bank_transfer',
    txn_ref    TEXT,
    status     TEXT    DEFAULT 'pending',
    notes      TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS withdrawals (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL,
    amount          REAL    NOT NULL,
    method          TEXT    DEFAULT 'bank_transfer',
    account_details TEXT,
    status          TEXT    DEFAULT 'pending',
    notes           TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// Seed default admin
const adminExists = db.prepare("SELECT id FROM users WHERE role='admin'").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare(`INSERT INTO users (name,email,phone,password_hash,balance,role)
              VALUES (?,?,?,?,?,?)`).run('Admin','admin@plixtrade.com','9999999999',hash,999999,'admin');
  console.log('✅ Admin created  →  admin@plixtrade.com / admin123');
}

// ── Trading Pairs ─────────────────────────────────────────────
const PAIRS = {
  'EUR/USD': { base: 1.0850,  pip: 0.0001 },
  'GBP/USD': { base: 1.2650,  pip: 0.0001 },
  'USD/JPY': { base: 149.50,  pip: 0.01   },
  'USD/CHF': { base: 0.8920,  pip: 0.0001 },
  'AUD/USD': { base: 0.6520,  pip: 0.0001 },
  'USD/CAD': { base: 1.3580,  pip: 0.0001 },
  'NZD/USD': { base: 0.6080,  pip: 0.0001 },
  'EUR/GBP': { base: 0.8580,  pip: 0.0001 },
  'EUR/JPY': { base: 162.20,  pip: 0.01   },
  'GBP/JPY': { base: 189.10,  pip: 0.01   },
  'EUR/CHF': { base: 0.9680,  pip: 0.0001 },
  'AUD/JPY': { base: 97.50,   pip: 0.01   },
  'GBP/CHF': { base: 1.1280,  pip: 0.0001 },
  'XAU/USD': { base: 2020.50, pip: 0.01   },
  'XAG/USD': { base: 22.85,   pip: 0.001  },
  'WTI/OIL': { base: 78.50,   pip: 0.01   },
  'BRENT':   { base: 83.20,   pip: 0.01   },
  'BTC/USD': { base: 43500,   pip: 1      },
  'ETH/USD': { base: 2280,    pip: 0.01   },
  'LTC/USD': { base: 72.50,   pip: 0.01   },
  'USD/INR': { base: 83.20,   pip: 0.01   },
  'USD/SGD': { base: 1.3420,  pip: 0.0001 },
};

// Simulate current price (adds random ±0.5% fluctuation)
function getCurrentPrice(pair) {
  const p = PAIRS[pair];
  if (!p) return 1;
  const change = (Math.random() * 0.01) - 0.005;
  return parseFloat((p.base * (1 + change)).toFixed(6));
}

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalid or expired' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── AUTH ROUTES ───────────────────────────────────────────────
app.post('/api/auth/register', (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password)
    return res.status(400).json({ error: 'Name, email & password required' });

  const exists = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (exists) return res.status(400).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`INSERT INTO users (name,email,phone,password_hash) VALUES (?,?,?,?)`)
                   .run(name, email, phone || '', hash);

  const user = db.prepare('SELECT id,name,email,role,balance,status,created_at FROM users WHERE id=?').get(result.lastInsertRowid);
  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status === 'blocked')
    return res.status(403).json({ error: 'Account blocked. Contact support.' });

  const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
  const { password_hash, ...safe } = user;
  res.json({ token, user: safe });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,role,balance,status,created_at FROM users WHERE id=?').get(req.user.id);
  res.json(user);
});

// ── PAIRS ─────────────────────────────────────────────────────
app.get('/api/pairs', auth, (req, res) => {
  const pairs = Object.entries(PAIRS).map(([symbol, data]) => ({
    symbol,
    price: getCurrentPrice(symbol),
    ...data
  }));
  res.json(pairs);
});

// ── TRADE ROUTES ──────────────────────────────────────────────
app.get('/api/trades', auth, (req, res) => {
  const { status, pair, limit = 50 } = req.query;
  let q = 'SELECT * FROM trades WHERE user_id=?';
  const params = [req.user.id];
  if (status) { q += ' AND status=?'; params.push(status); }
  if (pair)   { q += ' AND pair=?';   params.push(pair);   }
  q += ' ORDER BY created_at DESC LIMIT ?';
  params.push(parseInt(limit));
  res.json(db.prepare(q).all(...params));
});

app.post('/api/trades', auth, (req, res) => {
  const { pair, type, amount, leverage = 1 } = req.body;
  if (!pair || !type || !amount)
    return res.status(400).json({ error: 'pair, type & amount required' });
  if (!PAIRS[pair]) return res.status(400).json({ error: 'Invalid pair' });
  if (!['BUY','SELL'].includes(type)) return res.status(400).json({ error: 'type must be BUY or SELL' });
  if (amount <= 0) return res.status(400).json({ error: 'Amount must be positive' });

  const user = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });

  const entry_price = getCurrentPrice(pair);

  // Deduct balance
  db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(amount, req.user.id);

  const result = db.prepare(`
    INSERT INTO trades (user_id,pair,type,amount,leverage,entry_price,status)
    VALUES (?,?,?,?,?,?,'open')
  `).run(req.user.id, pair, type, amount, leverage, entry_price);

  res.json({ id: result.lastInsertRowid, pair, type, amount, entry_price, status: 'open' });
});

app.put('/api/trades/:id/close', auth, (req, res) => {
  const trade = db.prepare('SELECT * FROM trades WHERE id=? AND user_id=? AND status="open"')
                   .get(req.params.id, req.user.id);
  if (!trade) return res.status(404).json({ error: 'Open trade not found' });

  const exit_price = getCurrentPrice(trade.pair);
  const priceChange = (exit_price - trade.entry_price) / trade.entry_price;
  const raw_pnl = trade.amount * priceChange * trade.leverage;
  const profit_loss = parseFloat((trade.type === 'BUY' ? raw_pnl : -raw_pnl).toFixed(2));

  db.prepare(`UPDATE trades SET exit_price=?,profit_loss=?,status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?`)
    .run(exit_price, profit_loss, trade.id);

  // Return amount + PnL to balance
  db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(trade.amount + profit_loss, req.user.id);

  res.json({ id: trade.id, exit_price, profit_loss, status: 'closed' });
});

// ── WALLET ROUTES ─────────────────────────────────────────────
app.get('/api/wallet/balance', auth, (req, res) => {
  const user = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
  const deposits = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM deposits WHERE user_id=? AND status='approved'").get(req.user.id);
  const withdrawals = db.prepare("SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE user_id=? AND status='approved'").get(req.user.id);
  const pnl = db.prepare("SELECT COALESCE(SUM(profit_loss),0) as total FROM trades WHERE user_id=? AND status='closed'").get(req.user.id);
  res.json({
    balance: user.balance,
    total_deposited: deposits.total,
    total_withdrawn: withdrawals.total,
    total_pnl: pnl.total
  });
});

app.post('/api/wallet/deposit', auth, (req, res) => {
  const { amount, method, txn_ref } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const result = db.prepare(`INSERT INTO deposits (user_id,amount,method,txn_ref) VALUES (?,?,?,?)`)
                   .run(req.user.id, amount, method || 'bank_transfer', txn_ref || '');
  res.json({ id: result.lastInsertRowid, status: 'pending', message: 'Deposit request submitted. Pending admin approval.' });
});

app.post('/api/wallet/withdraw', auth, (req, res) => {
  const { amount, method, account_details } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const user = db.prepare('SELECT balance FROM users WHERE id=?').get(req.user.id);
  if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance' });
  const result = db.prepare(`INSERT INTO withdrawals (user_id,amount,method,account_details) VALUES (?,?,?,?)`)
                   .run(req.user.id, amount, method || 'bank_transfer', account_details || '');
  res.json({ id: result.lastInsertRowid, status: 'pending', message: 'Withdrawal request submitted. Pending admin approval.' });
});

app.get('/api/wallet/history', auth, (req, res) => {
  const deposits    = db.prepare('SELECT *,"deposit" as txn_type FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
  const withdrawals = db.prepare('SELECT *,"withdrawal" as txn_type FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(req.user.id);
  const all = [...deposits, ...withdrawals].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(all);
});

// ── ADMIN ROUTES ──────────────────────────────────────────────
app.get('/api/admin/stats', auth, adminOnly, (req, res) => {
  const users      = db.prepare("SELECT COUNT(*) as c FROM users WHERE role='user'").get();
  const deposits   = db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE status='approved'").get();
  const withdrawals= db.prepare("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE status='approved'").get();
  const pnl        = db.prepare("SELECT COALESCE(SUM(profit_loss),0) as s FROM trades WHERE status='closed'").get();
  const openTrades = db.prepare("SELECT COUNT(*) as c FROM trades WHERE status='open'").get();
  const pendingDep = db.prepare("SELECT COUNT(*) as c FROM deposits WHERE status='pending'").get();
  const pendingWit = db.prepare("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'").get();
  res.json({
    total_users:       users.c,
    total_deposits:    deposits.s,
    total_withdrawals: withdrawals.s,
    total_pnl:         pnl.s,
    open_trades:       openTrades.c,
    pending_deposits:  pendingDep.c,
    pending_withdrawals: pendingWit.c
  });
});

app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const users = db.prepare(`
    SELECT u.id,u.name,u.email,u.phone,u.balance,u.role,u.status,u.created_at,
           (SELECT COUNT(*) FROM trades WHERE user_id=u.id AND status='open') as open_trades,
           (SELECT COALESCE(SUM(profit_loss),0) FROM trades WHERE user_id=u.id AND status='closed') as total_pnl
    FROM users u WHERE u.role='user' ORDER BY u.created_at DESC
  `).all();
  res.json(users);
});

app.get('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const user = db.prepare('SELECT id,name,email,phone,balance,role,status,created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const trades = db.prepare('SELECT * FROM trades WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(user.id);
  const deposits = db.prepare('SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(user.id);
  const withdrawals = db.prepare('SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 20').all(user.id);
  res.json({ user, trades, deposits, withdrawals });
});

app.put('/api/admin/users/:id/balance', auth, adminOnly, (req, res) => {
  const { balance, action, amount } = req.body; // action: set|add|subtract
  let newBal;
  if (action === 'add') {
    const u = db.prepare('SELECT balance FROM users WHERE id=?').get(req.params.id);
    newBal = u.balance + parseFloat(amount);
  } else if (action === 'subtract') {
    const u = db.prepare('SELECT balance FROM users WHERE id=?').get(req.params.id);
    newBal = Math.max(0, u.balance - parseFloat(amount));
  } else {
    newBal = parseFloat(balance);
  }
  db.prepare('UPDATE users SET balance=? WHERE id=?').run(newBal, req.params.id);
  res.json({ balance: newBal, message: 'Balance updated' });
});

app.put('/api/admin/users/:id/status', auth, adminOnly, (req, res) => {
  const { status } = req.body;
  if (!['active','blocked'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE users SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ status, message: `User ${status}` });
});

app.put('/api/admin/users/:id/password', auth, adminOnly, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) return res.status(400).json({ error: 'Min 6 chars' });
  const hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash, req.params.id);
  res.json({ message: 'Password reset successfully' });
});

// Admin: Add manual trade
app.post('/api/admin/trades', auth, adminOnly, (req, res) => {
  const { user_id, pair, type, amount, entry_price, exit_price, profit_loss, status = 'closed', note } = req.body;
  if (!user_id || !pair || !type || !amount || !entry_price)
    return res.status(400).json({ error: 'Missing required fields' });

  const result = db.prepare(`
    INSERT INTO trades (user_id,pair,type,amount,entry_price,exit_price,profit_loss,status,note,closed_at)
    VALUES (?,?,?,?,?,?,?,?,?,${status === 'closed' ? 'CURRENT_TIMESTAMP' : 'NULL'})
  `).run(user_id, pair, type, amount, entry_price, exit_price || null, profit_loss || 0, status, note || '');

  // If closed trade, add PnL to user balance
  if (status === 'closed' && profit_loss) {
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(parseFloat(profit_loss), user_id);
  }

  res.json({ id: result.lastInsertRowid, message: 'Trade added manually' });
});

app.get('/api/admin/trades', auth, adminOnly, (req, res) => {
  const { user_id, status, pair } = req.query;
  let q = `SELECT t.*,u.name,u.email FROM trades t JOIN users u ON t.user_id=u.id WHERE 1=1`;
  const params = [];
  if (user_id) { q += ' AND t.user_id=?'; params.push(user_id); }
  if (status)  { q += ' AND t.status=?';  params.push(status);  }
  if (pair)    { q += ' AND t.pair=?';    params.push(pair);    }
  q += ' ORDER BY t.created_at DESC LIMIT 100';
  res.json(db.prepare(q).all(...params));
});

// Admin: Deposits management
app.get('/api/admin/deposits', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT d.*,u.name,u.email FROM deposits d JOIN users u ON d.user_id=u.id ORDER BY d.created_at DESC LIMIT 100`).all();
  res.json(rows);
});

app.put('/api/admin/deposits/:id', auth, adminOnly, (req, res) => {
  const { status, notes } = req.body;
  const dep = db.prepare('SELECT * FROM deposits WHERE id=?').get(req.params.id);
  if (!dep) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE deposits SET status=?,notes=? WHERE id=?').run(status, notes || '', dep.id);

  if (status === 'approved' && dep.status !== 'approved') {
    db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(dep.amount, dep.user_id);
  }
  res.json({ message: `Deposit ${status}` });
});

// Admin: Withdrawals management
app.get('/api/admin/withdrawals', auth, adminOnly, (req, res) => {
  const rows = db.prepare(`SELECT w.*,u.name,u.email FROM withdrawals w JOIN users u ON w.user_id=u.id ORDER BY w.created_at DESC LIMIT 100`).all();
  res.json(rows);
});

app.put('/api/admin/withdrawals/:id', auth, adminOnly, (req, res) => {
  const { status, notes } = req.body;
  const wit = db.prepare('SELECT * FROM withdrawals WHERE id=?').get(req.params.id);
  if (!wit) return res.status(404).json({ error: 'Not found' });

  db.prepare('UPDATE withdrawals SET status=?,notes=? WHERE id=?').run(status, notes || '', wit.id);

  if (status === 'approved' && wit.status !== 'approved') {
    db.prepare('UPDATE users SET balance=MAX(0,balance-?) WHERE id=?').run(wit.amount, wit.user_id);
  }
  res.json({ message: `Withdrawal ${status}` });
});

// ── Serve HTML pages ──────────────────────────────────────────
app.get('/',                 (_,r) => r.sendFile(path.join(__dirname,'public','index.html')));
app.get('/login',            (_,r) => r.sendFile(path.join(__dirname,'public','index.html')));
app.get('/user/dashboard',   (_,r) => r.sendFile(path.join(__dirname,'public','user','dashboard.html')));
app.get('/admin/dashboard',  (_,r) => r.sendFile(path.join(__dirname,'public','admin','dashboard.html')));

// ── Start ─────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 PlixTrade Pro running at http://localhost:${PORT}`);
  console.log(`   Admin: admin@plixtrade.com  |  Password: admin123\n`);
});
