export function normalizeSchemaTypes(type: unknown): string[] {
	return Array.isArray(type) ? (type as string[]) : type ? [type as string] : [];
}
