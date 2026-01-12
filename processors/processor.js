/**
 * ============================================================
 * ARTILLERY PROCESSOR WRAPPER
 * ============================================================
 * Artillery loads THIS file.
 * We simply merge and export all functional processors.
 */

module.exports = {
  ...require('./auth.processor'),
  ...require('./data.generator'),
  ...require('./pool.processor'),
  ...require('./metrics.processor'),
  ...require('./logging.processor'),
  ...require('./utils.processor')
};
