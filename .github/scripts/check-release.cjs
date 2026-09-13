'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const root = path.resolve(__dirname, '../..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const mode = process.env.RELEASE_AUTHENTICATION;

  assert.equal(process.env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Publish requires a manual dispatch.');
  assert.equal(process.env.CONFIRM_PUBLISH, 'true', 'Confirm public publication in the workflow inputs.');
  assert.equal(event.repository?.private, false, 'npm provenance requires a public repository.');
  assert.equal(process.env.GITHUB_REF, `refs/heads/${event.repository.default_branch}`,
    'Run the publication workflow from the default branch.');
  assert.equal(pkg.private === true, false, 'The package is marked private.');
  assert.equal(pkg.version, process.env.RELEASE_VERSION, 'The requested version must match package.json.');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'This workflow publishes stable versions only.');
  assert.equal(pkg.name, 'n8n-nodes-excellent-survey', 'Unexpected npm package name.');

  const expectedRepository = `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`;
  assert.equal(pkg.repository?.url, expectedRepository,
    `Set package.json repository.url to ${expectedRepository} before publishing.`);
  assert.ok(fs.existsSync(path.join(root, 'package-lock.json')), 'Commit package-lock.json before publishing.');
  assert.ok(['trusted', 'first-publication-token'].includes(mode), 'Unknown publication authentication mode.');

  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
    redirect: 'error',
  });
  if (response.status === 404) {
    assert.equal(mode, 'first-publication-token',
      'The package does not exist yet. Its first publication needs the temporary-token mode.');
  } else {
    assert.ok(response.ok, `Registry lookup failed with HTTP ${response.status}.`);
    const existing = await response.json();
    assert.equal(mode, 'trusted', 'This package already exists. Configure and use npm trusted publishing.');
    assert.ok(!Object.hasOwn(existing.versions ?? {}, pkg.version),
      `Version ${pkg.version} is already published; npm versions cannot be overwritten.`);
  }
  console.log(`Release preflight passed: ${pkg.name}@${pkg.version} from ${process.env.GITHUB_REPOSITORY}.`);
}

main().catch((error) => {
  console.error(`Release preflight failed: ${error.message}`);
  process.exitCode = 1;
});
