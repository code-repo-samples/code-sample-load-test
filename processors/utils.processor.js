/**
 * ============================================================
 * UTILITY PROCESSOR
 * ============================================================
 * Small helpers for correlation and weighted logic.
 */

let iterationCounter = 0;

/**
 * Global iteration counter for weighted execution.
 */
function getIterationNumber(context, events, done) {
  iterationCounter++;
  context.vars.iterationNumber = iterationCounter;
  done();
}

/**
 * ============================================================
 * GENERIC CORRELATION PROCESSOR
 * ============================================================
 *
 * Features:
 *  - Works per-request, per-VU (safe for multiple arrivals/VUs)
 *  - Supports nested JSON arrays via arrayPath
 *  - Supports multiple correlations per request
 *  - Chained correlations using previous index
 *  - Modes: FIRST, LAST, RANDOM, INDEX
 *  - Automatically scopes index variables per correlation
 *
 * Usage in YAML:
 *  - capture the array per request
 *  - set correlation variables (arrayVar, arrayPath, config) before calling function
 *  - call function "correlate"
 *
 * Example:
 *  - set:
 *      correlationArrayVar: "postsResponse"
 *      correlationArrayPath: ""   # optional
 *      correlationConfig:
 *        - target: "selectedId"
 *          field: "id"
 *          mode: "RANDOM"
 *          indexVar: "firstIndex"
 *        - target: "selectedTitle"
 *          field: "title"
 *          mode: "INDEX"
 *          indexFrom: "firstIndex"
 *  - function: "correlate"
 */

function correlate(userContext, events, done) {
  const arrayVar = userContext.vars.correlationArrayVar;
  const rawArray = userContext.vars[arrayVar];
  if (!rawArray) {
    console.warn(`[CORRELATE] arrayVar '${arrayVar}' not found`);
    return done();
  }

  const arr = resolvePath(rawArray, userContext.vars.correlationArrayPath || '') || [];
  const configList = userContext.vars.correlationConfig || [];

  configList.forEach(cfg => {
    if (!Array.isArray(arr) || arr.length === 0) {
      userContext.vars[cfg.target] = undefined;
      return;
    }

    let selectedIndex;

    // Use previous correlation index if mode=INDEX and indexFrom is defined
    if ((cfg.mode || '').toUpperCase() === 'INDEX' && cfg.indexFrom) {
      selectedIndex = userContext.vars[cfg.indexFrom];
      if (typeof selectedIndex !== 'number' || selectedIndex < 0 || selectedIndex >= arr.length) {
        selectedIndex = 0;
      }
    } else {
      switch ((cfg.mode || 'RANDOM').toUpperCase()) {
        case 'FIRST': selectedIndex = 0; break;
        case 'LAST': selectedIndex = arr.length - 1; break;
        case 'RANDOM': selectedIndex = Math.floor(Math.random() * arr.length); break;
        case 'INDEX': selectedIndex = Number(cfg.index) || 0; break;
        default: selectedIndex = 0;
      }
    }

    // Scope index per correlation
    const indexVarName = cfg.indexVar || `_correlation_${cfg.target}_index`;
    userContext.vars[indexVarName] = selectedIndex;

    // Assign field to target variable
    const item = arr[selectedIndex] || {};
    userContext.vars[cfg.target] = cfg.field ? item[cfg.field] : item;
  });

  done();
}

/**
 * Resolve nested paths in an object/array
 * Supports dot notation and brackets:
 *  - "data[0].comments" => arr of comments
 */
function resolvePath(obj, path) {
  if (!path) return obj;
  const segments = path
    .replace(/\[(\d+)\]/g, '.$1') // convert [0] to .0
    .split('.')
    .filter(Boolean);
  return segments.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
}

module.exports = {
  correlate,
  getIterationNumber
};
