/**
 * Renders the schema for the prompt.
 *
 * The JSON Schema goes in verbatim. An earlier version listed the fields as
 * prose (`- response (string, required): ...`) on the theory that it read more
 * naturally, but the model copied that shape back: it answered with
 * `response: Dạ chị...` instead of JSON, so every turn failed validation and
 * paid for a repair call. Showing the schema as JSON shows the model the shape
 * it is meant to produce, and keeps each field's `description` intact.
 */
export function schemaToPromptDescription(schema: Record<string, unknown>): string {
	return JSON.stringify(schema, null, 2);
}
