import { normalizeSchemaTypes } from './schemaTypes';

export interface SchemaValidationResult {
	valid: boolean;
	errors: string[];
}

function typeMatches(jsonType: string, value: unknown): boolean {
	switch (jsonType) {
		case 'string':
			return typeof value === 'string';
		case 'number':
			return typeof value === 'number';
		case 'integer':
			return typeof value === 'number' && Number.isInteger(value);
		case 'boolean':
			return typeof value === 'boolean';
		case 'array':
			return Array.isArray(value);
		case 'object':
			return typeof value === 'object' && value !== null && !Array.isArray(value);
		default:
			return true;
	}
}

function validateProperty(name: string, def: Record<string, unknown>, value: unknown): string[] {
	const errors: string[] = [];
	const types = normalizeSchemaTypes(def.type);

	if (value === null) {
		if (types.length && !types.includes('null')) {
			errors.push(`"${name}" must not be null`);
		}
		return errors;
	}

	const nonNullTypes = types.filter((t) => t !== 'null');
	if (nonNullTypes.length && !nonNullTypes.some((t) => typeMatches(t, value))) {
		errors.push(`"${name}" must be of type ${nonNullTypes.join(' or ')}, got ${typeof value}`);
	}

	if (Array.isArray(def.enum) && !def.enum.some((v) => v === value)) {
		errors.push(`"${name}" must be one of: ${def.enum.map((v) => JSON.stringify(v)).join(', ')}`);
	}

	return errors;
}

/**
 * Minimal validator for the flat, single-level object schemas this node
 * expects (string/number/integer/boolean/array/object properties, optional
 * nullable via `type: [x, "null"]`, optional `enum`, `required`,
 * `additionalProperties`). Not a general JSON Schema implementation.
 */
export function validateAgainstSchema(
	schema: Record<string, unknown>,
	data: unknown,
): SchemaValidationResult {
	const errors: string[] = [];

	if (typeof data !== 'object' || data === null || Array.isArray(data)) {
		return { valid: false, errors: ['The parsed value must be a JSON object'] };
	}

	const obj = data as Record<string, unknown>;
	const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
	const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

	for (const [name, def] of Object.entries(properties)) {
		const value = obj[name];
		if (value === undefined) {
			if (required.has(name)) errors.push(`Missing required field "${name}"`);
			continue;
		}
		errors.push(...validateProperty(name, def ?? {}, value));
	}

	if (schema.additionalProperties === false) {
		const extraKeys = Object.keys(obj).filter((key) => !(key in properties));
		if (extraKeys.length) {
			errors.push(`Fields not allowed by the schema: ${extraKeys.join(', ')}`);
		}
	}

	return { valid: errors.length === 0, errors };
}
