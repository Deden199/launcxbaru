import { Request, Response, NextFunction } from 'express';
import logger from '../logger'; // Import your Winston logger configuration

function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Log request details
  logger.info(`${req.method} ${req.url}`);

  // Store the start time of the request
  const startTime = new Date().getTime();

  // Log response details when the response is finished
  res.on('finish', () => {
    const endTime = new Date().getTime();
    const elapsedTime = endTime - startTime;

    logger.info(`Response Status: ${res.statusCode}`);
    logger.info(`Response Time: ${elapsedTime}ms`);
  });

  // Continue processing the request
  next();
}

export default requestLogger;
