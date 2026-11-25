type Generation = { message?: { response_metadata?: unknown }; [key: string]: unknown };

/** The parts of the LangChain adapter (or the RunnableBinding around it) that we touch. */
type Wrappable = {
	_generate?: (...args: unknown[]) => Promise<{ generations: Generation[] }>;
	bindTools?: (...args: unknown[]) => unknown;
	bound?: unknown;
	__qwenMetadataExposed?: boolean;
};

function generatingTarget(candidate: Wrappable): Wrappable | undefined {
	if (typeof candidate._generate === 'function') return candidate;
	const bound = candidate.bound as Wrappable | undefined;
	if (bound && typeof bound === 'object' && typeof bound._generate === 'function') return bound;
	return undefined;
}

/**
 * n8n's tracing keeps only `text` and `generationInfo` from each generation, so
 * `providerMetadata` - which the adapter puts on the message - never reaches the
 * log panel. Copy it onto `generationInfo` so the request/response echo and the
 * token usage show up in the UI and in saved execution data.
 *
 * `bindTools` returns a fresh adapter on each call; on n8n 2.x it comes back
 * wrapped in a RunnableBinding (`newAdapter.withConfig(...)`) that has no
 * `_generate` of its own, so the adapter inside it (`.bound`) is the one to wrap.
 */
export function exposeMetadataInLogPanel<T extends object>(adapter: T): T {
	const candidate = adapter as Wrappable;
	const target = generatingTarget(candidate);

	if (target && !target.__qwenMetadataExposed) {
		const generate = target._generate!.bind(target);
		target._generate = async (...args: unknown[]) => {
			const result = await generate(...args);
			result.generations = result.generations.map((generation) => ({
				...generation,
				generationInfo: generation.message?.response_metadata,
			}));
			return result;
		};
		target.__qwenMetadataExposed = true;
	}

	const bindTools = candidate.bindTools?.bind(candidate);
	if (bindTools) {
		candidate.bindTools = (...args: unknown[]) => {
			const result = bindTools(...args);
			return result && typeof result === 'object' ? exposeMetadataInLogPanel(result) : result;
		};
	}
	return adapter;
}
