import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';

import { config } from '../config';
import { createErrorResponse, createSuccessResponse } from '../util/response';
import { AuthRequest } from '../middleware/auth';

const prisma = new PrismaClient();

// Human login (PartnerUser)
export const loginUser = async (req: Request, res: Response) => {
  const { email, password, otp } = req.body as {
    email?: string
    password?: string
    otp?: string
  }
  const user = await prisma.partnerUser.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json(createErrorResponse('Invalid credentials'));
  }

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) {
    return res.status(401).json(createErrorResponse('Invalid credentials'));
  }
  if ((user as any).totpEnabled) {
    if (!otp) {
      return res.status(400).json(createErrorResponse('OTP wajib diisi'));
    }
    const secret = (user as any).totpSecret;
    if (
      !secret ||
      !authenticator.verify({ token: String(otp), secret })
    ) {
      return res.status(400).json(createErrorResponse('OTP tidak valid'));
    }
  }
  // <-- pakai config.api.jwtSecret
  const token = jwt.sign(
    { sub: user.id, role: user.role },
    config.api.jwtSecret,
    { expiresIn: '12h' }
  );

  return res.json(createSuccessResponse({
    user: { id: user.id, email: user.email },
    access_token: token
  }));
};

// Get current user
export const me = async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;
  const u = await prisma.partnerUser.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true, isActive: true }
  });
  if (!u) {
    return res.status(404).json(createErrorResponse('Not found'));
  }
  return res.json(createSuccessResponse(u));
};
