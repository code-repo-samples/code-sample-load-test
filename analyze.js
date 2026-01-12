/**
 * Artillery Analyzer
 *
 * Features:
 * - Overall metrics (min, mean, p50, p90, p95, p99, max)
 * - Per-endpoint metrics (single consolidated table)
 * - HTTP status code counts (all observed codes)
 * - Scenario / vuser counters
 * - Request TPS and Scenario TPS (overall + per phase)
 * - Optional phase handling via Artillery YAML
 * - Flattened CSV export with scenario + phase per request
 * - CI-safe console output (no colors)
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const Table = require('cli-table3');

/* ----------------------- Utility Functions ----------------------- */

/**
 * Calculate percentile from a sorted array
 */
function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Calculate arithmetic mean
 */
function mean(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Console + optional file writer
 */
function createWriter(outputFile) {
  let buffer = '';
  return {
    write(line = '') {
      console.log(line);
      buffer += line + '\n';
    },
    flush() {
      if (outputFile) {
        fs.writeFileSync(outputFile, buffer, 'utf8');
      }
    }
  };
}

/**
 * Build time-based phase buckets from YAML phases
 */
function buildPhaseBuckets(phases, testStart) {
  const buckets = [];
  let cursor = testStart;

  for (const phase of phases) {
    const durationMs = (phase.duration || 0) * 1000;
    buckets.push({
      name: phase.name || `Phase ${buckets.length + 1}`,
      start: cursor,
      end: cursor + durationMs,
      records: []
    });
    cursor += durationMs;
  }
  return buckets;
}

/* ----------------------- CSV Export ----------------------- */

/**
 * Flatten JSONL metrics to CSV
 * Safe even if phases/YAML are not provided
 */
function csvWriter(records, csvFile, phaseBuckets = [], showPhases = false) {
  const lines = [];
  lines.push(
    ['ts', 'humanTs', 'scenario', 'phase', 'name', 'method', 'statusCode', 'latencyMs'].join(',')
  );

  let activeScenario = '';

  for (const r of records) {
    const humanTs = new Date(r.ts).toISOString();

    if (r.type === 'vuser_start' || r.type === 'vuser_end') {
      activeScenario = r.scenario || '';
    }

    let phaseName = '';
    if (showPhases) {
      for (const p of phaseBuckets) {
        if (r.ts >= p.start && r.ts <= p.end) {
          phaseName = p.name;
          break;
        }
      }
    }

    lines.push([
      r.ts,
      humanTs,
      r.scenario || (r.latencyMs != null ? activeScenario : ''),
      phaseName,
      r.name || '',
      r.method || '',
      r.statusCode || '',
      typeof r.latencyMs === 'number' ? r.latencyMs : ''
    ].map(v => `"${v}"`).join(','));
  }

  try {
    fs.writeFileSync(path.resolve(csvFile), lines.join('\n'), 'utf8');
    console.log(`CSV file written: ${csvFile}`);
  } catch (err) {
    if (err.code === 'EBUSY') {
      console.error(`CSV file is open/locked: ${csvFile}`);
    } else {
      console.error(`CSV write error: ${err.message}`);
    }
  }
}

/* ----------------------- Main ----------------------- */

function main() {
  const args = process.argv.slice(2);
  const inputFile = args[0];

  let outputFile = null;
  let yamlFile = null;
  let csvFile = null;

  if (!inputFile) {
    console.error(
      'Usage: node analyze.js <metrics.jsonl> [output.txt] [--phases <yaml-file>] [--csv <csv-file>]'
    );
    process.exit(1);
  }

  // Parse CLI args
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--phases' && args[i + 1]) {
      yamlFile = args[++i];
    } else if (args[i] === '--csv' && args[i + 1]) {
      csvFile = args[++i];
    } else if (!outputFile) {
      outputFile = args[i];
    }
  }

  const writer = createWriter(outputFile);
  const records = fs.readFileSync(path.resolve(inputFile), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse);

  /* ----------------------- Aggregates ----------------------- */

  let vusersCreated = 0;
  let vusersCompleted = 0;
  const scenarioCounts = {};
  const endpoints = {};
  const statusCounts = {};
  const allLatencies = [];

  let startTs = Infinity;
  let endTs = 0;

  /* ----------------------- Phase Setup ----------------------- */

  let phaseBuckets = [];
  let showPhases = false;

  if (yamlFile && fs.existsSync(yamlFile)) {
    try {
      const doc = yaml.load(fs.readFileSync(yamlFile, 'utf8'));
      if (Array.isArray(doc?.config?.phases)) {
        const testStart = Math.min(...records.map(r => r.ts));
        phaseBuckets = buildPhaseBuckets(doc.config.phases, testStart);
        showPhases = true;
      }
    } catch (_) {
      // silently skip invalid YAML
    }
  }

  /* ----------------------- Process Records ----------------------- */

  let activeScenario = '';

  for (const r of records) {
    if (r.type === 'vuser_start') {
      vusersCreated++;
      scenarioCounts[r.scenario] = (scenarioCounts[r.scenario] || 0) + 1;
      activeScenario = r.scenario;
      startTs = Math.min(startTs, r.ts);
      continue;
    }

    if (r.type === 'vuser_end') {
      vusersCompleted++;
      activeScenario = r.scenario;
      endTs = Math.max(endTs, r.ts);
    }

    if (typeof r.latencyMs === 'number') {
      r.scenario = activeScenario;
      allLatencies.push(r.latencyMs);

      statusCounts[r.statusCode] = (statusCounts[r.statusCode] || 0) + 1;

      const ep = r.name || 'UNNAMED_REQUEST';
      endpoints[ep] ??= { latencies: [], pass: 0, fail: 0 };
      endpoints[ep].latencies.push(r.latencyMs);
      r.statusCode < 400 ? endpoints[ep].pass++ : endpoints[ep].fail++;

      startTs = Math.min(startTs, r.ts);
      endTs = Math.max(endTs, r.ts);
    }

    if (showPhases) {
      for (const p of phaseBuckets) {
        if (r.ts >= p.start && r.ts <= p.end) {
          p.records.push(r);
          break;
        }
      }
    }
  }

  const durationSec = (endTs - startTs) / 1000 || 1;
  const reqTPS = allLatencies.length / durationSec;
  const scenarioTPS = vusersCompleted / durationSec;

  /* ----------------------- Output ----------------------- */

  writer.write('\n=== Run Summary ===');

  const summaryTable = new Table({
    head: ['Metric', 'Value'],
    colWidths: [22, 15],
    style: { head: [], border: [] }
  });

  summaryTable.push(
    ['Total Requests', allLatencies.length],
    ['Request TPS', reqTPS.toFixed(2)],
    ['Scenario TPS', scenarioTPS.toFixed(2)],
    ['VUsers Created', vusersCreated],
    ['VUsers Completed', vusersCompleted],
    ['VUsers Failed', vusersCreated - vusersCompleted]
  );

  writer.write(summaryTable.toString());

  /* HTTP Status Codes */
  writer.write('\nHTTP Status Codes:');
  const codeTable = new Table({
    head: ['Code', 'Count'],
    colWidths: [10, 10],
    style: { head: [], border: [] }
  });
  Object.entries(statusCounts).forEach(([c, n]) => codeTable.push([c, n]));
  writer.write(codeTable.toString());

  /* Per Endpoint Table */
  writer.write('\nPer-Endpoint Metrics:');
  const epTable = new Table({
    head: ['Endpoint','Total','Pass','Fail','Min','Mean','P50','P90','P95','P99','Max'],
    colWidths: [25,6,6,6,6,8,6,6,6,6,6],
    style: { head: [], border: [] }
  });

  for (const [ep, s] of Object.entries(endpoints)) {
    const l = s.latencies.sort((a,b)=>a-b);
    epTable.push([
      ep, l.length, s.pass, s.fail,
      Math.min(...l),
      mean(l).toFixed(2),
      percentile(l,50),
      percentile(l,90),
      percentile(l,95),
      percentile(l,99),
      Math.max(...l)
    ]);
  }

  writer.write(epTable.toString());

  /* Phase-wise Metrics */
  if (showPhases) {
    writer.write('\nPhase-wise Metrics:');
    for (const phase of phaseBuckets) {
      const reqs = phase.records.filter(r => typeof r.latencyMs === 'number');
      if (!reqs.length) continue;

      const phaseDur = (phase.end - phase.start) / 1000 || 1;
      const phaseTPS = reqs.length / phaseDur;
      const phaseScenarioTPS =
        phase.records.filter(r => r.type === 'vuser_end').length / phaseDur;

      writer.write(`\nPhase: ${phase.name}`);
      writer.write(
        `Duration: ${phaseDur.toFixed(1)}s | Requests: ${reqs.length} | Req TPS: ${phaseTPS.toFixed(2)} | Scenario TPS: ${phaseScenarioTPS.toFixed(2)}`
      );

      const phaseEpMap = {};
      reqs.forEach(r => {
        phaseEpMap[r.name] ??= { latencies: [], pass: 0, fail: 0 };
        phaseEpMap[r.name].latencies.push(r.latencyMs);
        r.statusCode < 400 ? phaseEpMap[r.name].pass++ : phaseEpMap[r.name].fail++;
      });

      const phaseTable = new Table({
        head: ['Endpoint','Total','Pass','Fail','Min','Mean','P50','P90','P95','P99','Max'],
        colWidths: [25,6,6,6,6,8,6,6,6,6,6],
        style: { head: [], border: [] }
      });

      for (const [ep, s] of Object.entries(phaseEpMap)) {
        const l = s.latencies.sort((a,b)=>a-b);
        phaseTable.push([
          ep, l.length, s.pass, s.fail,
          Math.min(...l),
          mean(l).toFixed(2),
          percentile(l,50),
          percentile(l,90),
          percentile(l,95),
          percentile(l,99),
          Math.max(...l)
        ]);
      }

      writer.write(phaseTable.toString());
    }
  }

  if (csvFile) {
    csvWriter(records, csvFile, phaseBuckets, showPhases);
  }

  writer.flush();
}

main();


// # Basic analysis
// node analyze.js artillery-metrics.jsonl

// # With phases from YAML
// node analyze.js artillery-metrics.jsonl --phases load-test.yml

// # With CSV export
// node analyze.js artillery-metrics.jsonl --phases load-test.yml --csv report.csv

// # With console + text output
// node analyze.js artillery-metrics.jsonl output.txt --phases load-test.yml --csv report.csv
