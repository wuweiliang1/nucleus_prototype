import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { query } from './db.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isGuest: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input: string): string {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(normalized, 'base64').toString('utf8');
}

export function signToken(user: AuthUser): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: user.id,
      email: user.email,
      name: user.name,
      isGuest: user.isGuest,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14,
    })
  );
  const signature = base64UrlEncode(
    crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest()
  );
  return `${header}.${payload}.${signature}`;
}

export function verifyToken(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, sig] = parts;
    const expected = base64UrlEncode(
      crypto.createHmac('sha256', config.jwtSecret).update(`${header}.${payload}`).digest()
    );
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(base64UrlDecode(payload)) as {
      sub: string;
      email: string;
      name: string;
      isGuest?: boolean;
      exp: number;
    };
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      id: data.sub,
      email: data.email,
      name: data.name,
      isGuest: Boolean(data.isGuest),
    };
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const payload = verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }
    const result = await query<{ id: string; email: string; name: string; is_guest: boolean }>(
      'SELECT id, email, name, is_guest FROM users WHERE id = $1',
      [payload.id]
    );
    if (result.rows.length === 0) {
      res.status(401).json({ error: 'User no longer exists' });
      return;
    }
    const row = result.rows[0];
    req.user = {
      id: row.id,
      email: row.email,
      name: row.name,
      isGuest: row.is_guest,
    };
    next();
  } catch (err) {
    console.error('[Auth] Middleware error:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Service temporarily unavailable, please retry' });
  }
}
