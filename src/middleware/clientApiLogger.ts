import { NextFunction, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../core/prisma';
import logger from '../logger';
import { ClientAuthRequest } from './clientAuth';

type JsonValue = Prisma.JsonValue;

function safeJson(value: unknown): JsonValue | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    try {
      JSON.stringify(value);
      return value as JsonValue;
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function serialiseBody(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === 'string') return body;
  try {
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

function extractErrorMessage(body: unknown, statusMessage?: string): string | null {
  if (!body) return statusMessage ?? null;
  if (typeof body === 'string') return body.slice(0, 500);
  if (typeof body === 'object') {
    const maybeMessage = (body as any)?.message ?? (body as any)?.error ?? (body as any)?.errors;
    if (typeof maybeMessage === 'string') return maybeMessage.slice(0, 500);
  }
  return statusMessage ?? null;
}

function collectPayload(req: ClientAuthRequest): JsonValue | null {
  const payload: Record<string, unknown> = {};
  const hasBody = req.body && typeof req.body === 'object' && Object.keys(req.body).length > 0;
  if (hasBody) payload.body = req.body;

  const queryKeys = Object.keys(req.query ?? {});
  if (queryKeys.length > 0) payload.query = req.query;

  if ('rawBody' in req && !hasBody) {
    const raw = (req as any).rawBody;
    if (raw) payload.rawBody = raw;
  }

  if (Object.keys(payload).length === 0) return null;
  return safeJson(payload);
}

export function clientApiLogger(req: ClientAuthRequest, res: Response, next: NextFunction) {
  let responseBody: unknown;

  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    responseBody = body;
    return originalJson(body);
  };

  const originalSend = res.send.bind(res);
  res.send = (body: any) => {
    responseBody = body;
    return originalSend(body);
  };

  res.on('finish', async () => {
    if (!req.partnerClientId) return;
    if (res.statusCode < 400) return;

    try {
      await prisma.clientApiRequestLog.create({
        data: {
          partnerClientId: req.partnerClientId,
          method: req.method,
          path: req.originalUrl || req.path,
          statusCode: res.statusCode,
          errorMessage: extractErrorMessage(responseBody, res.statusMessage ?? undefined) ?? undefined,
          payload: collectPayload(req) ?? undefined,
          responseBody: serialiseBody(responseBody) ?? undefined,
        },
      });
    } catch (err) {
      if (err instanceof Error) {
        logger.error('Failed to persist client API log', { err });
      } else {
        logger.error('Failed to persist client API log', { err: String(err) });
      }
    }
  });

  next();
}
