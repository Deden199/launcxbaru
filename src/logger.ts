import path from 'path';
import { createLogger, transports, format } from 'winston';

const logFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  format.colorize(),
  format.printf(({ timestamp, level, message }) => {
    const formattedMessage = `${timestamp} [${level}]: ${message}`;

    // Check if the message is an object and pretty-print it
    if (message instanceof Object) {
      const objectString = JSON.stringify(message, null, 2);
      return `${formattedMessage}\n${objectString}`;
    }

    return formattedMessage;
  }),
);

const customLevels = {
  error: 0, // Define "error" as the highest level (0)
  warn: 1,
  info: 2,
  debug: 3,
};

const logDirectory = 'logs';

const logger = createLogger({
  levels: customLevels, // You can change the log level as needed.
  format: logFormat,
  transports: [
    new transports.Console(), // Log to the console
    new transports.File({ filename: path.join(logDirectory, 'error.log'), level: 'error' }), // Log errors to a file
    new transports.File({ filename: path.join(logDirectory, 'combined.log') }), // Log all levels to a separate file
  ],
});

export default logger;
