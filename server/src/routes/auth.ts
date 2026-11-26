import crypto from 'node:crypto';
import { Router } from 'express';
import { hashPassword, requireAuth, signToken, verifyPassword } from '../auth.js';
import { query } from '../db.js';

export const authRouter = Router();

authRouter.post('/register', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const name = String(req.body?.name || email.split('@')[0] || 'Builder').trim();

    if (!email || !email.includes('@')) {
      res.status(400).json({ error: '请输入有效的邮箱地址' });
      return;
    }
    if (password.length < 6) {
      res.status(400).json({ error: '密码长度至少为 6 位' });
      return;
    }

    const exists = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (exists.rows.length > 0) {
      res.status(409).json({ error: '该邮箱已注册，请直接登录' });
      return;
    }

    const id = crypto.randomUUID();
    const passwordHash = hashPassword(password);
    await query(
      'INSERT INTO users (id, email, name, password_hash, is_guest) VALUES ($1, $2, $3, $4, FALSE)',
      [id, email, name, passwordHash]
    );

    const user = { id, email, name, isGuest: false };
    res.json({ token: signToken(user), user });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '注册失败' });
  }
});

authRouter.post('/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const result = await query<{
      id: string;
      email: string;
      name: string;
      password_hash: string;
      is_guest: boolean;
    }>('SELECT id, email, name, password_hash, is_guest FROM users WHERE email = $1', [email]);

    if (result.rows.length === 0 || !verifyPassword(password, result.rows[0].password_hash)) {
      res.status(401).json({ error: '邮箱或密码错误' });
      return;
    }
    const row = result.rows[0];
    const user = { id: row.id, email: row.email, name: row.name, isGuest: row.is_guest };
    res.json({ token: signToken(user), user });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '登录失败' });
  }
});

authRouter.post('/guest', async (_req, res) => {
  try {
    const id = crypto.randomUUID();
    const shortId = id.slice(0, 6);
    const email = `guest-${shortId}@nucleus.local`;
    const name = `Guest-${shortId}`;
    const passwordHash = hashPassword(crypto.randomBytes(16).toString('hex'));
    await query(
      'INSERT INTO users (id, email, name, password_hash, is_guest) VALUES ($1, $2, $3, $4, TRUE)',
      [id, email, name, passwordHash]
    );
    const user = { id, email, name, isGuest: true };
    res.json({ token: signToken(user), user });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : '访客登录失败' });
  }
});

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
