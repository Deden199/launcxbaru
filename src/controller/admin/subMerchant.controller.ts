import { Request, Response } from 'express';
import { PrismaClient }     from '@prisma/client';
import { createErrorResponse } from '../../util/response';

const prisma = new PrismaClient();

export const listSubMerchants = async (req: Request, res: Response) => {
  const merchantId = req.params.id;
  const subs = await prisma.sub_merchant.findMany({ where: { merchantId } });
  return res.json(subs);
};

export const createSubMerchant = async (req: Request, res: Response) => {
  const merchantId = req.params.id;
  const { netzMerchantId, netzPartnerId } = req.body;
  if (!netzMerchantId || !netzPartnerId) {
    return res.status(400).json(createErrorResponse('netzMerchantId & netzPartnerId required'));
  }
  const sub = await prisma.sub_merchant.create({
    data: { merchantId, netzMerchantId, netzPartnerId }
  });
  return res.status(201).json(sub);
};

export const deleteSubMerchant = async (req: Request, res: Response) => {
  const { subId } = req.params;
  await prisma.sub_merchant.delete({ where: { id: subId } });
  return res.status(204).send();
};
