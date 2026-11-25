const assert = require('node:assert/strict');
const test = require('node:test');

const { exposeMetadataInLogPanel } = require('../nodes/QwenChatModel/exposeMetadata.ts');

const METADATA = { model: 'qwen3.7-plus', usage: { prompt_tokens: 10 } };

/** Minimal stand-in for the LangChain adapter `supplyModel` returns. */
function fakeAdapter(extra = {}) {
	const adapter = {
		generateCalls: 0,
		async _generate() {
			adapter.generateCalls++;
			return { generations: [{ text: 'x', message: { response_metadata: { ...METADATA } } }] };
		},
		...extra,
	};
	return adapter;
}

test('copies response_metadata to generationInfo on a plain adapter', async () => {
	const a = fakeAdapter();
	exposeMetadataInLogPanel(a);
	const r = await a._generate([]);
	assert.deepEqual(r.generations[0].generationInfo, METADATA);
});

test('wraps the adapter inside a RunnableBinding returned by bindTools', async () => {
	const inner = fakeAdapter();
	// n8n 2.x: bindTools returns newAdapter.withConfig(...), a binding with no _generate of its own
	const outer = fakeAdapter({ bindTools: () => ({ bound: inner, invoke() {} }) });
	exposeMetadataInLogPanel(outer);
	const binding = outer.bindTools([{ name: 't' }], { tool_choice: 'auto' });
	assert.equal(binding.bound, inner);
	const r = await inner._generate([]);
	assert.equal(r.generations[0].generationInfo.model, 'qwen3.7-plus');
});

test('still handles bindTools returning an adapter directly', async () => {
	const returned = fakeAdapter();
	const outer = fakeAdapter({ bindTools: () => returned });
	exposeMetadataInLogPanel(outer);
	const bound = outer.bindTools([{ name: 't' }]);
	assert.equal(bound, returned);
	const r = await bound._generate([]);
	assert.deepEqual(r.generations[0].generationInfo, METADATA);
});

test('passes every argument through to the original bindTools', () => {
	const seen = [];
	const outer = fakeAdapter({
		bindTools: (...args) => {
			seen.push(args);
			return fakeAdapter();
		},
	});
	exposeMetadataInLogPanel(outer);
	const tools = [{ name: 't' }];
	outer.bindTools(tools, { tool_choice: 'auto' });
	assert.deepEqual(seen, [[tools, { tool_choice: 'auto' }]]);
});

test('does not wrap the same adapter twice', async () => {
	const a = fakeAdapter();
	exposeMetadataInLogPanel(a);
	exposeMetadataInLogPanel(a);
	const r = await a._generate([]);
	assert.equal(a.generateCalls, 1);
	assert.deepEqual(r.generations[0].generationInfo, METADATA);
});

test('returns objects with nothing to wrap unchanged and does not throw', () => {
	const o = { bound: {} };
	assert.equal(exposeMetadataInLogPanel(o), o);
});
