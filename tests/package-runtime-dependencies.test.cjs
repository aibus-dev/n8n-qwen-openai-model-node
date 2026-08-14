const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../package.json');

test('n8n host packages are declared as peer dependencies', () => {
	assert.equal(packageJson.peerDependencies?.['n8n-workflow'], '*');
	assert.equal(packageJson.peerDependencies?.['@n8n/ai-node-sdk'], '*');
});

test('community package has no runtime dependencies', () => {
	assert.deepEqual(packageJson.dependencies ?? {}, {});
});

test('local development versions remain pinned', () => {
	assert.equal(packageJson.devDependencies?.['@n8n/ai-node-sdk'], '0.24.2');
	assert.equal(packageJson.devDependencies?.['n8n-workflow'], '2.34.2');
	assert.equal(packageJson.devDependencies?.zod, '3.25.76');
});
