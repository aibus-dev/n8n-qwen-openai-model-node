import type { GenerateResult, Message, MessageContent, StreamChunk } from '@n8n/ai-node-sdk';
import { OpenAIChatModel, type OpenAIChatModelConfig, type RequestConfig } from './model';
import { schemaToPromptDescription } from './schemaDescription';
import { validateAgainstSchema } from './jsonSchemaValidate';

export { parseStructuredOutputSchema } from './structuredOutputSchema';

function extractTextContent(content: MessageContent[]): string {
	return content
		.filter((part): part is Extract<MessageContent, { type: 'text' }> => part.type === 'text')
		.map((part) => part.text)
		.join('\n');
}

function tryParseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

function extractJson(raw: string): string {
	const trimmed = raw.trim();
	const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
	const unfenced = fenceMatch ? fenceMatch[1].trim() : trimmed;
	if (tryParseJson(unfenced) !== undefined) return unfenced;

	const start = unfenced.indexOf('{');
	const end = unfenced.lastIndexOf('}');
	if (start !== -1 && end > start) {
		const candidate = unfenced.slice(start, end + 1);
		if (tryParseJson(candidate) !== undefined) return candidate;
	}
	return unfenced;
}

function buildMainPromptAddition(fieldList: string): string {
	return [
		'---',
		'STRUCTURED OUTPUT RULES:',
		'- If you need to look up more information, call tools as usual - you do not need to follow the format below while doing so.',
		'- Only once you are ready to give the final answer to the customer (no more tool calls), you MUST output exactly one JSON object matching the fields below, with no extra text before/after and no markdown wrapping:',
		'',
		fieldList,
	].join('\n');
}

function buildRepairMessage(brokenOutput: string, fieldList: string): Message {
	const text = [
		'The content below does not match the required JSON format:',
		'',
		brokenOutput,
		'',
		'Convert it into valid JSON matching the fields below. PRESERVE as much of the original content as possible - do not invent new data and do not drop information that was already there:',
		'',
		fieldList,
	].join('\n');
	return { role: 'user', content: [{ type: 'text', text }] };
}

function injectIntoSystemMessage(messages: Message[], addition: string): Message[] {
	const idx = messages.findIndex((m) => m.role === 'system');
	if (idx === -1) {
		return [{ role: 'system', content: [{ type: 'text', text: addition }] }, ...messages];
	}
	return messages.map((m, i) =>
		i === idx ? { ...m, content: [...m.content, { type: 'text', text: addition }] } : m,
	);
}

/**
 * Wraps OpenAIChatModel to force the final answer (not tool calls) to match a
 * JSON Schema: main call gets a schema hint injected into the system prompt;
 * an invalid final answer triggers one repair call (no tools, native
 * response_format, full history preserved so extracted facts aren't lost);
 * an invalid repair falls back to `{}` rather than fabricating field values.
 */
export class StructuredOutputChatModel extends OpenAIChatModel {
	private readonly fieldListPrompt: string;
	private readonly mainPromptAddition: string;

	constructor(
		modelId: string,
		requests: RequestConfig,
		config: OpenAIChatModelConfig | undefined,
		private readonly schema: Record<string, unknown>,
	) {
		super(modelId, requests, config);
		this.fieldListPrompt = schemaToPromptDescription(schema);
		this.mainPromptAddition = buildMainPromptAddition(this.fieldListPrompt);
	}

	private async resolveStructuredText(
		rawText: string,
		originalMessages: Message[],
		config?: OpenAIChatModelConfig,
	): Promise<{ text: string; diagnostics: Record<string, unknown> }> {
		const extracted = extractJson(rawText);
		const parsed = tryParseJson(extracted);
		const firstCheck = parsed !== undefined ? validateAgainstSchema(this.schema, parsed) : undefined;
		if (firstCheck?.valid) {
			return { text: extracted, diagnostics: { structuredOutput: { valid: true, repaired: false } } };
		}

		const attempt1 = { rawText, errors: firstCheck?.errors ?? ['Could not parse JSON'] };

		try {
			const repairMessages = [...originalMessages, buildRepairMessage(rawText, this.fieldListPrompt)];
			const repairResult = await this.generateStructured(repairMessages, this.schema, config);
			const repairedRawText = extractTextContent(repairResult.message.content);
			const repairedExtracted = extractJson(repairedRawText);
			const repairedParsed = tryParseJson(repairedExtracted);
			const secondCheck =
				repairedParsed !== undefined ? validateAgainstSchema(this.schema, repairedParsed) : undefined;

			if (secondCheck?.valid) {
				return {
					text: repairedExtracted,
					diagnostics: {
						structuredOutput: {
							valid: true,
							repaired: true,
							attempt1,
							attempt2: { rawText: repairedRawText },
						},
					},
				};
			}

			return {
				text: '{}',
				diagnostics: {
					structuredOutput: {
						valid: false,
						repaired: false,
						fellBackToEmpty: true,
						attempt1,
						attempt2: {
							rawText: repairedRawText,
							errors: secondCheck?.errors ?? ['Could not parse JSON'],
						},
					},
				},
			};
		} catch (repairError) {
			return {
				text: '{}',
				diagnostics: {
					structuredOutput: {
						valid: false,
						fellBackToEmpty: true,
						attempt1,
						repairError: repairError instanceof Error ? repairError.message : String(repairError),
					},
				},
			};
		}
	}

	async generate(messages: Message[], config?: OpenAIChatModelConfig): Promise<GenerateResult> {
		const augmented = injectIntoSystemMessage(messages, this.mainPromptAddition);
		const result = await super.generate(augmented, config);

		const hasToolCall = result.message.content.some((part) => part.type === 'tool-call');
		if (hasToolCall) return result;

		const rawText = extractTextContent(result.message.content);
		const { text, diagnostics } = await this.resolveStructuredText(rawText, messages, config);

		const content: MessageContent[] = [
			...result.message.content.filter((part) => part.type !== 'text'),
			{ type: 'text', text },
		];

		return {
			...result,
			message: { ...result.message, content },
			providerMetadata: { ...result.providerMetadata, ...diagnostics },
		};
	}

	async *stream(messages: Message[], config?: OpenAIChatModelConfig): AsyncIterable<StreamChunk> {
		const augmented = injectIntoSystemMessage(messages, this.mainPromptAddition);
		let sawToolCall = false;
		let textBuffer = '';
		let finishChunk: Extract<StreamChunk, { type: 'finish' }> | undefined;
		const pending: StreamChunk[] = [];

		for await (const chunk of super.stream(augmented, config)) {
			if (sawToolCall) {
				yield chunk;
				continue;
			}
			if (chunk.type === 'tool-call-delta') {
				sawToolCall = true;
				for (const p of pending) yield p;
				yield chunk;
				continue;
			}
			if (chunk.type === 'text-delta') textBuffer += chunk.delta;
			if (chunk.type === 'finish') {
				finishChunk = chunk;
				break;
			}
			pending.push(chunk);
		}

		if (sawToolCall) return;

		const { text, diagnostics } = await this.resolveStructuredText(textBuffer, messages, config);
		yield { type: 'text-delta', delta: text };
		yield {
			...(finishChunk ?? { type: 'finish', finishReason: 'stop' }),
			providerMetadata: diagnostics,
		};
	}
}
