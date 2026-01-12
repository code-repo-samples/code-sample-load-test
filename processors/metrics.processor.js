/**
 * ============================================================
 * METRICS PROCESSOR
 * ============================================================
 * Captures:
 *  - Scenario lifecycle (VU start/end)
 *  - Per-request latency metrics
 *
 * Metrics are written as JSON Lines for:
 *  - Crash safety
 *  - Easy streaming / parsing
 *
 * Output location:
 *   <project-root>/_results/artillery-metrics.jsonl
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolve the Artillery project root (NOT processors folder).
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * Results directory (created if missing).
 */
const RESULTS_DIR = path.join(PROJECT_ROOT, '_results');

/**
 * Metrics file path.
 */
const METRICS_FILE = path.join(RESULTS_DIR, 'artillery-metrics.jsonl');

/**
 * ------------------------------------------------------------
 * ENSURE RESULTS DIRECTORY EXISTS
 * ------------------------------------------------------------
 */
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

/**
 * ------------------------------------------------------------
 * WRITE STREAM (APPEND MODE)
 * ------------------------------------------------------------
 */
const metricsStream = fs.createWriteStream(METRICS_FILE, {
  flags: 'a'
});

/**
 * ------------------------------------------------------------
 * GRACEFUL SHUTDOWN HANDLING
 * ------------------------------------------------------------
 * Ensures metrics are flushed before process exit.
 */
function shutdown() {
  try {
    metricsStream.end();
  } finally {
    process.exit();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

/**
 * ------------------------------------------------------------
 * SCENARIO START METRIC
 * ------------------------------------------------------------
 */
function scenarioStart(userContext, events, done) {
  metricsStream.write(
    JSON.stringify({
      ts: Date.now(),
      type: 'vuser_start',
      scenario: userContext.scenario?.name || 'UNKNOWN'
    }) + '\n'
  );

  done();
}

/**
 * ------------------------------------------------------------
 * SCENARIO END METRIC
 * ------------------------------------------------------------
 */
function scenarioEnd(userContext, events, done) {
  metricsStream.write(
    JSON.stringify({
      ts: Date.now(),
      type: 'vuser_end',
      scenario: userContext.scenario?.name || 'UNKNOWN'
    }) + '\n'
  );

  done();
}

/**
 * ------------------------------------------------------------
 * PER-REQUEST METRICS CAPTURE
 * ------------------------------------------------------------
 * Captures latency if available.
 */
function captureMetrics(requestParams, response, userContext, ee, next) {
  const latency = response?.timings?.phases?.total;

  if (typeof latency === 'number') {
    metricsStream.write(
      JSON.stringify({
        ts: Date.now(),
        type: 'request',
        name: requestParams.name || 'UNNAMED',
        method: requestParams.method,
        statusCode: response.statusCode,
        latencyMs: latency
      }) + '\n'
    );
  }

  next();
}

module.exports = {
  scenarioStart,
  scenarioEnd,
  captureMetrics
};
