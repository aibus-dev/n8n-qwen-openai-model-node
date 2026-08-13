const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');

test('@n8n/ai-node-sdk is installed as a runtime dependency', () => {
	assert.equal(packageJson.dependencies?.['@n8n/ai-node-sdk'], '0.24.2');
});

test('n8n-workflow is isolated from older community-node versions', () => {
	assert.equal(packageJson.dependencies?.['n8n-workflow'], '2.34.2');
});

test('Zod supports the v4 compatibility subpath used by n8n 2.34', () => {
	assert.equal(packageJson.dependencies?.zod, '3.25.76');
});
