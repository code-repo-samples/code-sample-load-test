/**
 * ============================================================
 * POOL PROCESSOR
 * ============================================================
 * Reads test data from CSV files using a persistent pointer.
 *
 * Guarantees:
 *  - No duplicate usage within a run
 *  - Pointer persistence across runs (optional)
 *  - Safe concurrent access across VUs
 *  - Graceful stop when data runs out
 *
 * Behavior is controlled from YAML via:
 *   resetPointer: true | false
 */

const fs = require('fs');
const path = require('path');

/**
 * Resolve the Artillery project root (not the processors folder).
 * This keeps CSV and pointer paths stable even when processors
 * are nested.
 */
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * In-memory CSV pools, loaded once per worker process.
 * Keyed by filename.
 */
const pools = {};

/**
 * Tracks whether a pool is fully consumed.
 * Once drained, all VUs skip further work.
 */
let isDrained = false;

/**
 * Tracks whether pointer reset has already happened
 * for a given file in this process.
 *
 * Ensures reset happens ONCE per run, not per VU.
 */
const pointerResetDone = {};

/**
 * Pulls the next row from a CSV file and maps it to variables.
 *
 * YAML variables supported:
 *   sourceFile   - CSV file name (relative to project root)
 *   targetVar    - Single variable name (default: productId)
 *   columnMap    - Array of variable names for multi-column CSV
 *   resetPointer - Boolean: reset pointer at start of run
 */
function pullFromPool(userContext, events, done) {
  // If pool already exhausted, skip this VU entirely
  if (isDrained) {
    userContext.vars.skipMe = true;
    return done();
  }

  const fileName = userContext.vars.sourceFile || 'created_products.csv';
  const targetVar = userContext.vars.targetVar || 'productId';
  const columnMap = userContext.vars.columnMap;
  const resetPointer = userContext.vars.resetPointer === true;

  /**
   * ------------------------------------------------------------
   * LOAD CSV INTO MEMORY (ONCE PER WORKER)
   * ------------------------------------------------------------
   */
  if (!pools[fileName]) {
    const csvPath = path.resolve(PROJECT_ROOT, fileName);

    if (!fs.existsSync(csvPath)) {
      return done(new Error(`CSV not found at path: ${csvPath}`));
    }

    pools[fileName] = fs
      .readFileSync(csvPath, 'utf8')
      .replace(/^\uFEFF/, '') // Strip BOM if present
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
  }

  /**
   * ------------------------------------------------------------
   * POINTER FILE RESOLUTION
   * ------------------------------------------------------------
   * Pointer lives next to the CSV at project root.
   */
  const pointerFile = path.resolve(
    PROJECT_ROOT,
    `.${path.basename(fileName)}.pointer`
  );

  try {
    /**
     * ----------------------------------------------------------
     * RESET POINTER (ONCE PER RUN, IF REQUESTED)
     * ----------------------------------------------------------
     */
    if (resetPointer && !pointerResetDone[fileName]) {
      fs.writeFileSync(pointerFile, '0'); // overwrite is safest
      pointerResetDone[fileName] = true;
    }

    /**
     * Ensure pointer file exists
     */
    if (!fs.existsSync(pointerFile)) {
      fs.writeFileSync(pointerFile, '0');
    }

    /**
     * Read current pointer value
     */
    const index =
      parseInt(fs.readFileSync(pointerFile, 'utf8'), 10) || 0;

    /**
     * ----------------------------------------------------------
     * END-OF-DATA HANDLING
     * ----------------------------------------------------------
     */
    if (index >= pools[fileName].length) {
      console.log('--- ⏹️ DATA POOL DRAINED ---');
      isDrained = true;
      userContext.vars.skipMe = true;

      // Gracefully stop the test shortly
      setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
      return done();
    }

    /**
     * ----------------------------------------------------------
     * MAP CSV ROW TO CONTEXT VARIABLES
     * ----------------------------------------------------------
     */
    const row = pools[fileName][index].split(',');

    if (Array.isArray(columnMap)) {
      columnMap.forEach((varName, i) => {
        userContext.vars[varName] = row[i]?.trim();
      });
    } else {
      userContext.vars[targetVar] = row[0]?.trim();
    }

    /**
     * Advance pointer for next VU
     */
    fs.writeFileSync(pointerFile, String(index + 1));

    userContext.vars.skipMe = false;

  } catch (err) {
    return done(err);
  }

  return done();
}

module.exports = { pullFromPool };
