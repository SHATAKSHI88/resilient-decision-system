const { nodeEnv } = require('../config/env');

class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const notFound = (req, res, next) => next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';

  let details = err.details;
  if (err.name === 'ValidationError') {
    status = 400;
    details = Object.fromEntries(Object.entries(err.errors || {}).map(([k, e]) => [k, e.message]));
  }
  if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'Malformed JSON body';
  }
  if (err.code === 11000) {
    status = 409;
    message = 'Duplicate request ID, please retry';
  }
  if (err.name === 'CastError') {
    status = 400;
    message = 'Invalid identifier';
  }

  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    success: false,
    error: { status, message, ...(details ? { details } : {}) },
    ...(nodeEnv === 'development' && status >= 500 ? { stack: err.stack } : {}),
  });
};

module.exports = { ApiError, notFound, errorHandler };
