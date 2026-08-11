/**
 * Minimal zod -> JSON Schema conversion for tool parameters.
 *
 * The SDK's `getParametersJsonSchema` converts only when the schema passes
 * `instanceof ZodSchema`. n8n builds tool schemas with its own copy of zod, and
 * `instanceof` is false across copies, so the raw zod object reaches the request
 * and the model gets a meaningless `parameters` - it then never calls the tool.
 *
 * Everything here is read structurally rather than through the zod API, so it
 * works no matter which copy (or major version) produced the schema. Both zod 3
 * (`_def.typeName`, e.g. `ZodObject`) and zod 4 (`_def.type`, e.g. `object`)
 * layouts are handled; anything unrecognised degrades to a permissive schema so
 * the tool stays callable.
 */

type JsonSchema = Record<string, unknown>;

interface ZodDef {
	typeName?: string;
	type?: string;
	description?: string;
	[key: string]: unknown;
}

interface ZodLike {
	_def?: ZodDef;
	_zod?: { def?: ZodDef };
	description?: string;
}

const PERMISSIVE: JsonSchema = { type: 'object', properties: {}, additionalProperties: true };

/**
 * zod 4 exposes its definition as `_zod.def` and keeps `_def` as an alias; zod 3
 * only has `_def`. Reading both is what the zod docs recommend for library
 * authors, and it keeps zod-mini style builds working too.
 */
function defOf(value: unknown): ZodDef | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const node = value as ZodLike;
	const def = node._zod?.def ?? node._def;
	return typeof def === 'object' && def !== null ? def : undefined;
}

export function isZodLike(value: unknown): value is ZodLike {
	return defOf(value) !== undefined;
}

/** Normalises zod 3's `ZodString` and zod 4's `string` to a single tag. */
function kindOf(def: ZodDef): string {
	if (typeof def.typeName === 'string') {
		return def.typeName.replace(/^Zod/, '').toLowerCase();
	}
	if (typeof def.type === 'string') return def.type.toLowerCase();
	return '';
}

/** zod 3 stores object shape behind a thunk, zod 4 stores it directly. */
function shapeOf(def: ZodDef): Record<string, unknown> {
	const shape = def.shape;
	if (typeof shape === 'function') {
		return (shape as () => Record<string, unknown>)();
	}
	if (typeof shape === 'object' && shape !== null) {
		return shape as Record<string, unknown>;
	}
	return {};
}

/** Wrappers that make a property optional rather than changing its type. */
function isOptionalWrapper(kind: string): boolean {
	return kind === 'optional' || kind === 'default' || kind === 'nullish';
}

/**
 * Picks the first candidate that is actually a schema. `_def.type` holds the
 * element schema in zod 3 but the kind name (a string) in zod 4, so candidates
 * have to be checked rather than merely coalesced.
 */
function firstSchema(...candidates: unknown[]): unknown {
	return candidates.find(isZodLike);
}

function innerOf(def: ZodDef): unknown {
	return firstSchema(def.innerType, def.schema, def.in, def.type);
}

function withDescription(schema: JsonSchema, node: ZodLike, def: ZodDef): JsonSchema {
	const description = node.description ?? def.description;
	return typeof description === 'string' && description
		? { ...schema, description }
		: schema;
}

function convertNode(node: unknown, depth: number): JsonSchema {
	const def = defOf(node);
	if (depth > 12 || def === undefined) return {};

	const self = node as ZodLike;
	const kind = kindOf(def);
	const recur = (child: unknown) => convertNode(child, depth + 1);

	switch (kind) {
		case 'string':
			return withDescription({ type: 'string' }, self, def);
		case 'number':
		case 'bigint':
			return withDescription({ type: 'number' }, self, def);
		case 'int':
			return withDescription({ type: 'integer' }, self, def);
		case 'boolean':
			return withDescription({ type: 'boolean' }, self, def);
		case 'date':
			return withDescription({ type: 'string', format: 'date-time' }, self, def);
		case 'null':
			return { type: 'null' };
		case 'any':
		case 'unknown':
			return {};

		case 'literal': {
			// zod 3 keeps a single `value`, zod 4 an array of `values`.
			const values = Array.isArray(def.values) ? def.values : [def.value];
			return withDescription(
				values.length === 1 ? { const: values[0] } : { enum: values },
				self,
				def,
			);
		}

		case 'enum': {
			// zod 3: `values` array. zod 4: `entries` object.
			const values = Array.isArray(def.values)
				? def.values
				: typeof def.entries === 'object' && def.entries !== null
					? Object.values(def.entries as Record<string, unknown>)
					: [];
			return withDescription({ type: 'string', enum: values }, self, def);
		}

		case 'nativeenum': {
			const entries = (def.values ?? {}) as Record<string, unknown>;
			return withDescription({ enum: Object.values(entries) }, self, def);
		}

		case 'array': {
			const items = recur(firstSchema(def.type, def.element, def.items));
			return withDescription({ type: 'array', items }, self, def);
		}

		case 'tuple': {
			const items = Array.isArray(def.items) ? def.items.map(recur) : [];
			return withDescription({ type: 'array', items }, self, def);
		}

		case 'object':
		case 'interface': {
			const shape = shapeOf(def);
			const properties: JsonSchema = {};
			const required: string[] = [];

			for (const [key, child] of Object.entries(shape)) {
				properties[key] = recur(child);
				const childDef = defOf(child);
				if (!(childDef && isOptionalWrapper(kindOf(childDef)))) {
					required.push(key);
				}
			}

			const schema: JsonSchema = { type: 'object', properties };
			if (required.length) schema.required = required;
			schema.additionalProperties = false;
			return withDescription(schema, self, def);
		}

		case 'record': {
			const values = recur(firstSchema(def.valueType, def.valueSchema));
			return withDescription({ type: 'object', additionalProperties: values }, self, def);
		}

		case 'union': {
			const options = Array.isArray(def.options) ? def.options.map(recur) : [];
			return withDescription({ anyOf: options }, self, def);
		}

		case 'nullable': {
			const inner = recur(innerOf(def));
			const innerType = inner.type;
			return typeof innerType === 'string'
				? { ...inner, type: [innerType, 'null'] }
				: { anyOf: [inner, { type: 'null' }] };
		}

		case 'optional':
		case 'default':
		case 'nullish':
		case 'effects':
		case 'pipe':
		case 'transform':
		case 'readonly':
		case 'catch':
		case 'branded':
		case 'lazy': {
			// Wrappers that do not change the JSON shape - unwrap and carry the
			// description down, since it is often set on the wrapper.
			const inner = recur(innerOf(def));
			const merged = withDescription(inner, self, def);
			if (kind === 'default' && 'defaultValue' in def) {
				const raw = def.defaultValue;
				merged.default = typeof raw === 'function' ? (raw as () => unknown)() : raw;
			}
			return merged;
		}

		default:
			return {};
	}
}

/**
 * Converts a zod schema to JSON Schema. Always returns an object schema, since
 * that is what the Chat Completions `parameters` field requires.
 */
export function zodToJsonSchema(schema: unknown): JsonSchema {
	try {
		const converted = convertNode(schema, 0);
		if (converted.type === 'object' && converted.properties) return converted;
		// A tool whose parameters are not an object still has to present one.
		return PERMISSIVE;
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
	} catch (e) {
		return PERMISSIVE;
	}
}
