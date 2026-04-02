// ============================================================
//  PlixTrade Pro v2  —  server.js  (Turso Cloud DB)
// ============================================================
const express  = require('express');
const cors     = require('cors');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const path     = require('path');
const { createClient } = require('@libsql/client');

const app = express();
const PORT       = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'plixtrade_super_secret_2024';

// ── Turso Database ────────────────────────────────────────────
const db = createClient({
  url:       process.env.TURSO_URL   || 'libsql://plixtrade-adarshpawarji.aws-ap-south-1.turso.io',
  authToken: process.env.TURSO_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3NzUxMDUwMzMsImlkIjoiMDE5ZDRjODAtMDgwMS03YWE2LTg0YzktYWZkMTUyNjY1MmMyIiwicmlkIjoiODQ3NTFkNzctNTc1YS00MjVlLTg1ZWYtZGYzNTQ0YWZkOThjIn0.kaqsPCat-xqy_bKXT3ImTLRNewA2MqriYLcb4W0HzAB7n3MyxcZtCGFG0xCc3_b3kQynz0IoZSPOzuySIeCGAg'
});

// ── Init Tables ───────────────────────────────────────────────
async function initDB() {
  await db.executeMultiple(`
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
      closed_at    DATETIME
    );
    CREATE TABLE IF NOT EXISTS deposits (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL,
      amount     REAL    NOT NULL,
      method     TEXT    DEFAULT 'bank_transfer',
      txn_ref    TEXT,
      status     TEXT    DEFAULT 'pending',
      notes      TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS withdrawals (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id         INTEGER NOT NULL,
      amount          REAL    NOT NULL,
      method          TEXT    DEFAULT 'bank_transfer',
      account_details TEXT,
      status          TEXT    DEFAULT 'pending',
      notes           TEXT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed admin
  const res = await db.execute("SELECT id FROM users WHERE role='admin' LIMIT 1");
  if (res.rows.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    await db.execute({
      sql: `INSERT INTO users (name,email,phone,password_hash,balance,role) VALUES (?,?,?,?,?,?)`,
      args: ['Admin','admin@plixtrade.com','9999999999', hash, 999999, 'admin']
    });
    console.log('✅ Admin created  →  admin@plixtrade.com / admin123');
  }
  console.log('✅ Turso DB connected & tables ready');
}

// ── Pairs ─────────────────────────────────────────────────────
const PAIRS = {
  'EUR/USD': { base:1.0850, pip:0.0001 }, 'GBP/USD': { base:1.2650, pip:0.0001 },
  'USD/JPY': { base:149.50, pip:0.01   }, 'USD/CHF': { base:0.8920, pip:0.0001 },
  'AUD/USD': { base:0.6520, pip:0.0001 }, 'USD/CAD': { base:1.3580, pip:0.0001 },
  'NZD/USD': { base:0.6080, pip:0.0001 }, 'EUR/GBP': { base:0.8580, pip:0.0001 },
  'EUR/JPY': { base:162.20, pip:0.01   }, 'GBP/JPY': { base:189.10, pip:0.01   },
  'EUR/CHF': { base:0.9680, pip:0.0001 }, 'AUD/JPY': { base:97.50,  pip:0.01   },
  'GBP/CHF': { base:1.1280, pip:0.0001 }, 'XAU/USD': { base:2020.5, pip:0.01   },
  'XAG/USD': { base:22.85,  pip:0.001  }, 'WTI/OIL': { base:78.50,  pip:0.01   },
  'BRENT':   { base:83.20,  pip:0.01   }, 'BTC/USD': { base:43500,  pip:1      },
  'ETH/USD': { base:2280,   pip:0.01   }, 'LTC/USD': { base:72.50,  pip:0.01   },
  'USD/INR': { base:83.20,  pip:0.01   }, 'USD/SGD': { base:1.3420, pip:0.0001 },
};
function getCurrentPrice(pair) {
  const p = PAIRS[pair]; if (!p) return 1;
  return parseFloat((p.base * (1 + (Math.random()*0.01)-0.005)).toFixed(6));
}

// ── Helpers ───────────────────────────────────────────────────
function rows(r)     { return r.rows.map(row => Object.fromEntries(Object.entries(row))); }
function firstRow(r) { const row = r.rows[0]; return row ? Object.fromEntries(Object.entries(row)) : null; }

// ── Middleware ────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token invalid or expired' }); }
}
function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── AUTH ──────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;
    if (!name||!email||!password) return res.status(400).json({ error: 'Name, email & password required' });
    const exists = firstRow(await db.execute({ sql:'SELECT id FROM users WHERE email=?', args:[email] }));
    if (exists) return res.status(400).json({ error: 'Email already registered' });
    const hash = bcrypt.hashSync(password, 10);
    const r = await db.execute({ sql:`INSERT INTO users (name,email,phone,password_hash) VALUES (?,?,?,?)`, args:[name,email,phone||'',hash] });
    const user = firstRow(await db.execute({ sql:'SELECT id,name,email,role,balance,status,created_at FROM users WHERE id=?', args:[r.lastInsertRowid] }));
    const token = jwt.sign({ id:user.id, email:user.email, role:user.role }, JWT_SECRET, { expiresIn:'7d' });
    res.json({ token, user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = firstRow(await db.execute({ sql:'SELECT * FROM users WHERE email=?', args:[email] }));
    if (!user||!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error:'Invalid credentials' });
    if (user.status==='blocked') return res.status(403).json({ error:'Account blocked. Contact support.' });
    const token = jwt.sign({ id:user.id, email:user.email, role:user.role }, JWT_SECRET, { expiresIn:'7d' });
    const { password_hash, ...safe } = user;
    res.json({ token, user: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const user = firstRow(await db.execute({ sql:'SELECT id,name,email,phone,role,balance,status,created_at FROM users WHERE id=?', args:[req.user.id] }));
    res.json(user);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── PAIRS ─────────────────────────────────────────────────────
app.get('/api/pairs', auth, (req, res) => {
  res.json(Object.entries(PAIRS).map(([symbol, data]) => ({ symbol, price: getCurrentPrice(symbol), ...data })));
});

// ── TRADES ────────────────────────────────────────────────────
app.get('/api/trades', auth, async (req, res) => {
  try {
    const { status, pair, limit=50 } = req.query;
    let sql='SELECT * FROM trades WHERE user_id=?'; const args=[req.user.id];
    if (status) { sql+=' AND status=?'; args.push(status); }
    if (pair)   { sql+=' AND pair=?';   args.push(pair); }
    sql+=' ORDER BY created_at DESC LIMIT ?'; args.push(parseInt(limit));
    res.json(rows(await db.execute({ sql, args })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/trades', auth, async (req, res) => {
  try {
    const { pair, type, amount, leverage=1 } = req.body;
    if (!pair||!type||!amount) return res.status(400).json({ error:'pair, type & amount required' });
    if (!PAIRS[pair]) return res.status(400).json({ error:'Invalid pair' });
    if (!['BUY','SELL'].includes(type)) return res.status(400).json({ error:'type must be BUY or SELL' });
    if (amount<=0) return res.status(400).json({ error:'Amount must be positive' });
    const user = firstRow(await db.execute({ sql:'SELECT balance FROM users WHERE id=?', args:[req.user.id] }));
    if (user.balance < amount) return res.status(400).json({ error:'Insufficient balance' });
    const entry_price = getCurrentPrice(pair);
    await db.execute({ sql:'UPDATE users SET balance=balance-? WHERE id=?', args:[amount, req.user.id] });
    const r = await db.execute({ sql:`INSERT INTO trades (user_id,pair,type,amount,leverage,entry_price,status) VALUES (?,?,?,?,?,?,'open')`, args:[req.user.id,pair,type,amount,leverage,entry_price] });
    res.json({ id:Number(r.lastInsertRowid), pair, type, amount, entry_price, status:'open' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/trades/:id/close', auth, async (req, res) => {
  try {
    const trade = firstRow(await db.execute({ sql:'SELECT * FROM trades WHERE id=? AND user_id=? AND status="open"', args:[req.params.id, req.user.id] }));
    if (!trade) return res.status(404).json({ error:'Open trade not found' });
    const exit_price = getCurrentPrice(trade.pair);
    const priceChange = (exit_price - trade.entry_price) / trade.entry_price;
    const raw_pnl = trade.amount * priceChange * trade.leverage;
    const profit_loss = parseFloat((trade.type==='BUY' ? raw_pnl : -raw_pnl).toFixed(2));
    await db.execute({ sql:`UPDATE trades SET exit_price=?,profit_loss=?,status='closed',closed_at=CURRENT_TIMESTAMP WHERE id=?`, args:[exit_price, profit_loss, trade.id] });
    await db.execute({ sql:'UPDATE users SET balance=balance+? WHERE id=?', args:[trade.amount+profit_loss, req.user.id] });
    res.json({ id:Number(trade.id), exit_price, profit_loss, status:'closed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── WALLET ────────────────────────────────────────────────────
app.get('/api/wallet/balance', auth, async (req, res) => {
  try {
    const user = firstRow(await db.execute({ sql:'SELECT balance FROM users WHERE id=?', args:[req.user.id] }));
    const dep  = firstRow(await db.execute({ sql:"SELECT COALESCE(SUM(amount),0) as total FROM deposits WHERE user_id=? AND status='approved'", args:[req.user.id] }));
    const wit  = firstRow(await db.execute({ sql:"SELECT COALESCE(SUM(amount),0) as total FROM withdrawals WHERE user_id=? AND status='approved'", args:[req.user.id] }));
    const pnl  = firstRow(await db.execute({ sql:"SELECT COALESCE(SUM(profit_loss),0) as total FROM trades WHERE user_id=? AND status='closed'", args:[req.user.id] }));
    res.json({ balance:user.balance, total_deposited:dep.total, total_withdrawn:wit.total, total_pnl:pnl.total });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wallet/deposit', auth, async (req, res) => {
  try {
    const { amount, method, txn_ref } = req.body;
    if (!amount||amount<=0) return res.status(400).json({ error:'Valid amount required' });
    const r = await db.execute({ sql:`INSERT INTO deposits (user_id,amount,method,txn_ref) VALUES (?,?,?,?)`, args:[req.user.id,amount,method||'bank_transfer',txn_ref||''] });
    res.json({ id:Number(r.lastInsertRowid), status:'pending', message:'Deposit request submitted. Pending admin approval.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/wallet/withdraw', auth, async (req, res) => {
  try {
    const { amount, method, account_details } = req.body;
    if (!amount||amount<=0) return res.status(400).json({ error:'Valid amount required' });
    const user = firstRow(await db.execute({ sql:'SELECT balance FROM users WHERE id=?', args:[req.user.id] }));
    if (user.balance < amount) return res.status(400).json({ error:'Insufficient balance' });
    const r = await db.execute({ sql:`INSERT INTO withdrawals (user_id,amount,method,account_details) VALUES (?,?,?,?)`, args:[req.user.id,amount,method||'bank_transfer',account_details||''] });
    res.json({ id:Number(r.lastInsertRowid), status:'pending', message:'Withdrawal request submitted. Pending admin approval.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/wallet/history', auth, async (req, res) => {
  try {
    const deps = rows(await db.execute({ sql:'SELECT *,"deposit" as txn_type FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 30', args:[req.user.id] }));
    const wits = rows(await db.execute({ sql:'SELECT *,"withdrawal" as txn_type FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 30', args:[req.user.id] }));
    res.json([...deps,...wits].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── ADMIN ─────────────────────────────────────────────────────
app.get('/api/admin/stats', auth, adminOnly, async (req, res) => {
  try {
    const [users,dep,wit,pnl,open,pdep,pwit] = await Promise.all([
      db.execute("SELECT COUNT(*) as c FROM users WHERE role='user'"),
      db.execute("SELECT COALESCE(SUM(amount),0) as s FROM deposits WHERE status='approved'"),
      db.execute("SELECT COALESCE(SUM(amount),0) as s FROM withdrawals WHERE status='approved'"),
      db.execute("SELECT COALESCE(SUM(profit_loss),0) as s FROM trades WHERE status='closed'"),
      db.execute("SELECT COUNT(*) as c FROM trades WHERE status='open'"),
      db.execute("SELECT COUNT(*) as c FROM deposits WHERE status='pending'"),
      db.execute("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'"),
    ]);
    res.json({ total_users:firstRow(users).c, total_deposits:firstRow(dep).s, total_withdrawals:firstRow(wit).s,
               total_pnl:firstRow(pnl).s, open_trades:firstRow(open).c, pending_deposits:firstRow(pdep).c, pending_withdrawals:firstRow(pwit).c });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users', auth, adminOnly, async (req, res) => {
  try {
    const r = await db.execute(`SELECT u.id,u.name,u.email,u.phone,u.balance,u.role,u.status,u.created_at,
      (SELECT COUNT(*) FROM trades WHERE user_id=u.id AND status='open') as open_trades,
      (SELECT COALESCE(SUM(profit_loss),0) FROM trades WHERE user_id=u.id AND status='closed') as total_pnl
      FROM users u WHERE u.role='user' ORDER BY u.created_at DESC`);
    res.json(rows(r));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/users/:id', auth, adminOnly, async (req, res) => {
  try {
    const user = firstRow(await db.execute({ sql:'SELECT id,name,email,phone,balance,role,status,created_at FROM users WHERE id=?', args:[req.params.id] }));
    if (!user) return res.status(404).json({ error:'User not found' });
    const [trades,deposits,withdrawals] = await Promise.all([
      db.execute({ sql:'SELECT * FROM trades WHERE user_id=? ORDER BY created_at DESC LIMIT 20', args:[user.id] }),
      db.execute({ sql:'SELECT * FROM deposits WHERE user_id=? ORDER BY created_at DESC LIMIT 20', args:[user.id] }),
      db.execute({ sql:'SELECT * FROM withdrawals WHERE user_id=? ORDER BY created_at DESC LIMIT 20', args:[user.id] }),
    ]);
    res.json({ user, trades:rows(trades), deposits:rows(deposits), withdrawals:rows(withdrawals) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id/balance', auth, adminOnly, async (req, res) => {
  try {
    const { action, amount, balance } = req.body;
    let newBal;
    if (action==='add') {
      const u = firstRow(await db.execute({ sql:'SELECT balance FROM users WHERE id=?', args:[req.params.id] }));
      newBal = u.balance + parseFloat(amount);
    } else if (action==='subtract') {
      const u = firstRow(await db.execute({ sql:'SELECT balance FROM users WHERE id=?', args:[req.params.id] }));
      newBal = Math.max(0, u.balance - parseFloat(amount));
    } else { newBal = parseFloat(balance); }
    await db.execute({ sql:'UPDATE users SET balance=? WHERE id=?', args:[newBal, req.params.id] });
    res.json({ balance:newBal, message:'Balance updated' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id/status', auth, adminOnly, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active','blocked'].includes(status)) return res.status(400).json({ error:'Invalid status' });
    await db.execute({ sql:'UPDATE users SET status=? WHERE id=?', args:[status, req.params.id] });
    res.json({ status, message:`User ${status}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/users/:id/password', auth, adminOnly, async (req, res) => {
  try {
    const { new_password } = req.body;
    if (!new_password||new_password.length<6) return res.status(400).json({ error:'Min 6 chars' });
    await db.execute({ sql:'UPDATE users SET password_hash=? WHERE id=?', args:[bcrypt.hashSync(new_password,10), req.params.id] });
    res.json({ message:'Password reset successfully' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/trades', auth, adminOnly, async (req, res) => {
  try {
    const { user_id,pair,type,amount,entry_price,exit_price,profit_loss,status='closed',note } = req.body;
    if (!user_id||!pair||!type||!amount||!entry_price) return res.status(400).json({ error:'Missing required fields' });
    const closedAt = status==='closed' ? 'CURRENT_TIMESTAMP' : 'NULL';
    const r = await db.execute({ sql:`INSERT INTO trades (user_id,pair,type,amount,entry_price,exit_price,profit_loss,status,note,closed_at) VALUES (?,?,?,?,?,?,?,?,?,${closedAt})`, args:[user_id,pair,type,amount,entry_price,exit_price||null,profit_loss||0,status,note||''] });
    if (status==='closed'&&profit_loss) await db.execute({ sql:'UPDATE users SET balance=balance+? WHERE id=?', args:[parseFloat(profit_loss),user_id] });
    res.json({ id:Number(r.lastInsertRowid), message:'Trade added manually' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/trades', auth, adminOnly, async (req, res) => {
  try {
    const { user_id, status, pair } = req.query;
    let sql=`SELECT t.*,u.name,u.email FROM trades t JOIN users u ON t.user_id=u.id WHERE 1=1`; const args=[];
    if (user_id) { sql+=' AND t.user_id=?'; args.push(user_id); }
    if (status)  { sql+=' AND t.status=?';  args.push(status); }
    if (pair)    { sql+=' AND t.pair=?';    args.push(pair); }
    sql+=' ORDER BY t.created_at DESC LIMIT 100';
    res.json(rows(await db.execute({ sql, args })));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/deposits', auth, adminOnly, async (req, res) => {
  try { res.json(rows(await db.execute(`SELECT d.*,u.name,u.email FROM deposits d JOIN users u ON d.user_id=u.id ORDER BY d.created_at DESC LIMIT 100`))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/deposits/:id', auth, adminOnly, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const dep = firstRow(await db.execute({ sql:'SELECT * FROM deposits WHERE id=?', args:[req.params.id] }));
    if (!dep) return res.status(404).json({ error:'Not found' });
    await db.execute({ sql:'UPDATE deposits SET status=?,notes=? WHERE id=?', args:[status,notes||'',dep.id] });
    if (status==='approved'&&dep.status!=='approved') await db.execute({ sql:'UPDATE users SET balance=balance+? WHERE id=?', args:[dep.amount,dep.user_id] });
    res.json({ message:`Deposit ${status}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/withdrawals', auth, adminOnly, async (req, res) => {
  try { res.json(rows(await db.execute(`SELECT w.*,u.name,u.email FROM withdrawals w JOIN users u ON w.user_id=u.id ORDER BY w.created_at DESC LIMIT 100`))); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/withdrawals/:id', auth, adminOnly, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const wit = firstRow(await db.execute({ sql:'SELECT * FROM withdrawals WHERE id=?', args:[req.params.id] }));
    if (!wit) return res.status(404).json({ error:'Not found' });
    await db.execute({ sql:'UPDATE withdrawals SET status=?,notes=? WHERE id=?', args:[status,notes||'',wit.id] });
    if (status==='approved'&&wit.status!=='approved') await db.execute({ sql:'UPDATE users SET balance=MAX(0,balance-?) WHERE id=?', args:[wit.amount,wit.user_id] });
    res.json({ message:`Withdrawal ${status}` });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Pages ─────────────────────────────────────────────────────
app.get('/',               (_,r)=>r.sendFile(path.join(__dirname,'public','index.html')));
app.get('/login',          (_,r)=>r.sendFile(path.join(__dirname,'public','index.html')));
app.get('/user/dashboard', (_,r)=>r.sendFile(path.join(__dirname,'public','user','dashboard.html')));
app.get('/admin/dashboard',(_,r)=>r.sendFile(path.join(__dirname,'public','admin','dashboard.html')));

// ── Start ─────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`\n🚀 PlixTrade Pro → http://localhost:${PORT}\n`));
}).catch(err => { console.error('❌ DB init failed:', err.message); process.exit(1); });
