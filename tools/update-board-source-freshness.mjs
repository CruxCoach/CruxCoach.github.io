#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'tools', 'board-source-freshness.json');
const current = JSON.parse(readFileSync(target, 'utf8'));
const repository = current.repository;

if (!repository || !current.boards || typeof current.boards !== 'object') {
  throw new Error('tools/board-source-freshness.json has no repository/boards contract');
}

const next = { repository, boards: {} };
for (const [board, record] of Object.entries(current.boards)) {
  if (!record.file || !/^[a-z0-9.-]+\.geojson$/i.test(record.file)) {
    throw new Error(`invalid source filename for ${board}`);
  }
  const endpoint = `https://api.github.com/repos/${repository}/commits?path=geojson/${encodeURIComponent(record.file)}&per_page=1`;
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CruxCoach-board-source-freshness/1.0',
    },
  });
  if (!response.ok) throw new Error(`${board}: GitHub returned HTTP ${response.status}`);
  const commits = await response.json();
  const latest = commits?.[0];
  const changedAt = latest?.commit?.committer?.date;
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(changedAt ?? '') || !/^[0-9a-f]{40}$/.test(latest?.sha ?? '')) {
    throw new Error(`${board}: GitHub returned no trustworthy latest commit`);
  }
  next.boards[board] = {
    file: record.file,
    last_data_change: changedAt.slice(0, 10),
    commit: latest.sha,
    status: record.status === 'frozen' ? 'frozen' : 'available',
  };
}

const rendered = JSON.stringify(next, null, 2) + '\n';
if (rendered !== readFileSync(target, 'utf8')) {
  writeFileSync(target, rendered);
  process.stdout.write('updated tools/board-source-freshness.json\n');
} else {
  process.stdout.write('board source freshness unchanged\n');
}
