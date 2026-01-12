/**
 * ============================================================
 * LOGGING PROCESSOR
 * ============================================================
 * Handles:
 *  - Persisting created IDs
 *  - Global error threshold enforcement
 */

const fs = require('fs');

let globalErrorCount = 0;
const ERROR_THRESHOLD = 50000;
let shuttingDown = false;

/**
 * Saves created product IDs.
 */
function logProductId(requestParams, response, userContext, ee, next) {
  if (response.statusCode === 201) {
    fs.appendFileSync('created_products.txt', `${userContext.vars.productId}\n`);
  }
  next();
}

/**
 * Enforces global error threshold.
 */
function logResponse(requestParams, response, userContext, ee, next) {
  if (response.statusCode >= 400) {
    globalErrorCount++;
    if (!shuttingDown && globalErrorCount >= ERROR_THRESHOLD) {
      shuttingDown = true;
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
    }
  }
  next();
}

module.exports = {
  logProductId,
  logResponse
};
