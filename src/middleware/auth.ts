import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
}

export const authMiddleware = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const auth = req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, config.api.jwtSecret) as { sub: string; role: string };
    req.userId   = payload.sub;
    req.userRole = payload.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Khusus untuk admin: setelah authMiddleware dipanggil, cek role
export const requireAdminAuth = [
  authMiddleware,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.userRole !== 'ADMIN' && req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Admins only' });
    }
    next();
  }
];      
export const requireSuperAdminAuth = [
  authMiddleware,
  (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Forbidden: Super Admins only' });
    }
    next();
  }
];