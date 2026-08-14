import { z } from 'zod';

const jsonSchemaType = z.enum([
	'string',
	'number',
	'integer',
	'boolean',
	'array',
	'object',
	'null',
]);

const propertyDefinitionSchema = z
	.object({
		type: z.union([jsonSchemaType, z.array(jsonSchemaType).min(1)]),
		description: z.string().optional(),
		default: z.unknown().optional(),
		enum: z.array(z.unknown()).min(1).optional(),
	})
	.passthrough();

const objectJsonSchema = z
	.object({
		type: z.literal('object'),
		properties: z.record(propertyDefinitionSchema),
		required: z.array(z.string()).optional(),
		additionalProperties: z
			.union([z.boolean(), z.record(z.unknown())])
			.optional(),
	})
	.passthrough()
	.superRefine((schema, context) => {
		const required = schema.required ?? [];
		if (new Set(required).size !== required.length) {
			context.addIssue({
				code: z.ZodIssueCode.custom,
				path: ['required'],
				message: 'Required property names must be unique',
			});
		}

		for (const name of required) {
			if (!(name in schema.properties)) {
				context.addIssue({
					code: z.ZodIssueCode.custom,
					path: ['required'],
					message: `Required property "${name}" is not defined in properties`,
				});
			}
		}
	});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatIssues(error: z.ZodError): string {
	return error.issues
		.map((issue) => `${issue.path.join('.') || 'schema'}: ${issue.message}`)
		.join('; ');
}

/**
 * Parses and validates the flat object JSON Schema subset supported by this
 * node before the schema is included in a Qwen request.
 */
export function parseStructuredOutputSchema(schemaInput: unknown): Record<string, unknown> {
	const parsed: unknown = typeof schemaInput === 'string' ? JSON.parse(schemaInput) : schemaInput;

	if (!isRecord(parsed)) {
		throw new Error('JSON Schema must be an object');
	}
	if (parsed.type !== 'object') {
		throw new Error('JSON Schema root type must be "object"');
	}
	if (!isRecord(parsed.properties)) {
		throw new Error('JSON Schema must contain a "properties" object');
	}

	const result = objectJsonSchema.safeParse(parsed);
	if (!result.success) {
		throw new Error(`Invalid JSON Schema: ${formatIssues(result.error)}`);
	}

	return result.data as Record<string, unknown>;
}
