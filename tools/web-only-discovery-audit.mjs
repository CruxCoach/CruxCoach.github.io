#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function auditWebDiscovery(matrix, ledger) {
  const errors = [];
  if (matrix.schema !== 'cruxcoach-web-only-discovery-matrix-v1') errors.push('unknown matrix schema');
  if (ledger.schema !== 'cruxcoach-web-only-discovery-ledger-v1') errors.push('unknown ledger schema');
  const boardIds = new Set(matrix.boards.map(row => row.id));
  const regionIds = new Set(matrix.regions.map(row => row.id));
  const passIds = new Set(matrix.passes.map(row => row.id));
  if (passIds.size < matrix.minimum_completed_passes) errors.push('matrix defines fewer passes than its minimum');
  for (const [index, board] of matrix.boards.entries()) {
    if (!board.id || !Array.isArray(board.spellings) || board.spellings.length === 0) errors.push(`board[${index}] lacks spellings`);
  }
  for (const [index, region] of matrix.regions.entries()) {
    if (!Array.isArray(region.countries) || region.countries.length === 0) errors.push(`region[${index}] lacks countries`);
    if (!Array.isArray(region.languages) || region.languages.length === 0) errors.push(`region[${index}] lacks languages`);
    for (const language of region.languages ?? []) {
      if (!matrix.lexicons[language]) errors.push(`region[${index}] uses missing lexicon ${language}`);
      for (const pass of matrix.passes) for (const family of pass.query_families ?? []) {
        if (!Array.isArray(matrix.lexicons[language]?.[family]) || matrix.lexicons[language][family].length === 0) errors.push(`lexicon ${language} lacks ${family}`);
      }
    }
  }
  const expected = new Set();
  for (const pass of matrix.passes) for (const board of matrix.boards) {
    for (const region of matrix.regions) expected.add(`${pass.id}|${board.id}|${region.id}`);
  }
  const completed = new Set();
  const seen = new Set();
  for (const [index, row] of ledger.coverage.entries()) {
    const key = `${row.pass}|${row.board}|${row.region}`;
    const errorCount = errors.length;
    if (!passIds.has(row.pass) || !boardIds.has(row.board) || !regionIds.has(row.region)) errors.push(`coverage[${index}] has unknown matrix key`);
    if (seen.has(key)) errors.push(`coverage[${index}] duplicates ${key}`);
    seen.add(key);
    if (row.status === 'complete') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(row.checked ?? '')) errors.push(`coverage[${index}] complete row lacks checked date`);
      if (!Array.isArray(row.languages) || row.languages.length === 0) errors.push(`coverage[${index}] complete row lacks languages`);
      if (!Array.isArray(row.queries) || row.queries.length === 0) errors.push(`coverage[${index}] complete row lacks exact queries`);
      if (row.queries?.some(query => typeof query !== 'string' || !query.trim())) errors.push(`coverage[${index}] has invalid query`);
      if (!Number.isInteger(row.results_reviewed) || row.results_reviewed < 0) errors.push(`coverage[${index}] has invalid reviewed count`);
      if (!Number.isInteger(row.candidates_found) || row.candidates_found < 0) errors.push(`coverage[${index}] has invalid candidate count`);
      if (errors.length === errorCount) completed.add(key);
    }
  }
  const recheckSeen = new Set();
  for (const [index, row] of (ledger.rechecks ?? []).entries()) {
    const key = `${row.pass}|${row.board}|${row.region}|${row.iteration}`;
    if (!passIds.has(row.pass) || !boardIds.has(row.board) || !regionIds.has(row.region)) errors.push(`rechecks[${index}] has unknown matrix key`);
    if (!Number.isInteger(row.iteration) || row.iteration < 2) errors.push(`rechecks[${index}] has invalid iteration`);
    if (recheckSeen.has(key)) errors.push(`rechecks[${index}] duplicates ${key}`);
    recheckSeen.add(key);
    if (row.status !== 'complete') errors.push(`rechecks[${index}] is not complete`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.checked ?? '')) errors.push(`rechecks[${index}] lacks checked date`);
    if (!Array.isArray(row.languages) || row.languages.length === 0) errors.push(`rechecks[${index}] lacks languages`);
    if (!Array.isArray(row.queries) || row.queries.length === 0) errors.push(`rechecks[${index}] lacks exact queries`);
    if (row.queries?.some(query => typeof query !== 'string' || !query.trim())) errors.push(`rechecks[${index}] has invalid query`);
    if (!Number.isInteger(row.results_reviewed) || row.results_reviewed < 0) errors.push(`rechecks[${index}] has invalid reviewed count`);
    if (!Number.isInteger(row.candidates_found) || row.candidates_found < 0) errors.push(`rechecks[${index}] has invalid candidate count`);
    if (!Number.isInteger(row.production_changes) || row.production_changes < 0) errors.push(`rechecks[${index}] has invalid production-change count`);
    if (typeof row.note !== 'string' || !row.note.trim()) errors.push(`rechecks[${index}] lacks note`);
  }
  for (const [index, row] of ledger.candidates.entries()) {
    if (!boardIds.has(row.board)) errors.push(`candidate[${index}] has unknown board`);
    if (!regionIds.has(row.region)) errors.push(`candidate[${index}] has unknown region`);
    if (!row.name || !row.discovered_by || !row.status || !row.note) errors.push(`candidate[${index}] is incomplete`);
    if (!Array.isArray(row.official_sources)) errors.push(`candidate[${index}] lacks official_sources array`);
    if (row.official_sources?.some(url => !/^https:\/\//.test(url))) errors.push(`candidate[${index}] has non-HTTPS official source`);
  }
  const missing = [...expected].filter(key => !completed.has(key));
  const completePasses = matrix.passes.filter(pass => matrix.boards.every(board => matrix.regions.every(region => completed.has(`${pass.id}|${board.id}|${region.id}`)))).map(pass => pass.id);
  return { expected: expected.size, completed: completed.size, missing, completePasses, rechecks: recheckSeen.size, candidates: ledger.candidates.length, errors };
}

export function loadAudit(root = ROOT) {
  const matrix = JSON.parse(readFileSync(join(root, 'tools/web-only-discovery-matrix.json'), 'utf8'));
  const ledger = JSON.parse(readFileSync(join(root, 'tools/web-only-discovery-ledger.json'), 'utf8'));
  return auditWebDiscovery(matrix, ledger);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const audit = loadAudit();
  console.log(`web-only discovery: ${audit.completed}/${audit.expected} matrix cells complete; ${audit.rechecks} repeated cells; ${audit.candidates} candidates; complete passes: ${audit.completePasses.join(', ') || 'none'}`);
  if (audit.errors.length) console.error(audit.errors.join('\n'));
  if (audit.missing.length) console.log(`pending cells: ${audit.missing.length}`);
  process.exitCode = audit.errors.length ? 1 : 0;
}
