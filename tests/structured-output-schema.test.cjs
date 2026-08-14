const assert = require('node:assert/strict');
const test = require('node:test');

const {
	parseStructuredOutputSchema,
} = require('../nodes/QwenChatModel/structuredOutputSchema.ts');

const validSchema = {
	type: 'object',
	properties: {
		response: { type: 'string' },
		attachment: { type: 'string', default: '' },
		isStopOrder: { type: 'boolean', default: false },
	},
	required: ['response', 'attachment', 'isStopOrder'],
	additionalProperties: false,
};

test('accepts the supported object JSON Schema shape', () => {
	assert.deepEqual(parseStructuredOutputSchema(JSON.stringify(validSchema)), validSchema);
});

test('rejects malformed JSON text', () => {
	assert.throws(() => parseStructuredOutputSchema('{'), SyntaxError);
});

test('rejects non-object schema roots', () => {
	assert.throws(() => parseStructuredOutputSchema(null), /schema must be an object/i);
	assert.throws(() => parseStructuredOutputSchema([]), /schema must be an object/i);
});

test('requires an object schema with properties', () => {
	assert.throws(
		() => parseStructuredOutputSchema({ type: 'array', items: { type: 'string' } }),
		/root type must be "object"/i,
	);
	assert.throws(
		() => parseStructuredOutputSchema({ type: 'object' }),
		/properties/i,
	);
});

test('rejects unsupported property type declarations', () => {
	assert.throws(
		() =>
			parseStructuredOutputSchema({
				type: 'object',
				properties: { response: { type: 'not-a-json-type' } },
			}),
		/response\.type/i,
	);
});

test('rejects required names that are absent from properties', () => {
	assert.throws(
		() =>
			parseStructuredOutputSchema({
				...validSchema,
				required: [...validSchema.required, 'missingField'],
			}),
		/missingField.*not defined/i,
	);
});
