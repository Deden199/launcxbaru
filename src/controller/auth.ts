import { Request, Response } from 'express';
import { createErrorResponse, createSuccessResponse } from '../util/response';
import { generateToken } from '../service/auth';

const generateAccessToken = async (req: Request, res: Response) => {
  try {
    const creds: AuthCredential = {
      clientId: req.body.clientId,
      signedJwt: req.body.signedJwt
    }
    const token = await generateToken(creds);
    return res.status(200).json(createSuccessResponse({ access_token: token }));
  } catch (error) {
    return res.status(500).json(createErrorResponse('Error generating token'));
  }
};

const authController = {
  generateAccessToken,
};

export default authController;
