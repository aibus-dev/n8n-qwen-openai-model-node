import type { IHttpRequestMethods } from 'n8n-workflow';
import {
	BaseChatModel,
	getParametersJsonSchema,
	parseSSEStream,
	type FinishReason,
	type TokenUsage,
	type Tool,
	type ToolCall,
	type ChatModelConfig,
	type GenerateResult,
	type Message,
	type MessageContent,
	type ProviderTool,
	type StreamChunk,
} from '@n8n/ai-node-sdk';
import { isZodLike, zodToJsonSchema } from './zodToJsonSchema';

// Types

interface OpenAIFunctionToolDef {
	type: 'function';
	function: {
		name: string;
		description?: string;
		parameters: unknown;
		strict?: boolean;
	};
}

type OpenAIToolChoice = 'auto' | 'required' | 'none' | { type: 'function'; function: { name: string } };

interface ChatCompletionsMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null;
	name?: string;
	tool_call_id?: string;
	tool_calls?: Array<{
		id: string;
		type: 'function';
		function: { name: string; arguments: string };
	}>;
}

interface ResponseFormatJsonSchema {
	type: 'json_schema';
	json_schema: {
		name: string;
		schema: Record<string, unknown>;
		strict?: boolean;
	};
}

interface OpenAIChatCompletionsRequest {
	model: string;
	messages: ChatCompletionsMessage[];
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
	stop?: string[];
	seed?: number;
	presence_penalty?: number;
	frequency_penalty?: number;
	tools?: OpenAIFunctionToolDef[];
	tool_choice?: OpenAIToolChoice;
	parallel_tool_calls?: boolean;
	response_format?: ResponseFormatJsonSchema;
	enable_search?: boolean;
	enable_thinking?: boolean;
	thinking_budget?: number;
	stream?: boolean;
	stream_options?: { include_usage: boolean };
}

interface OpenAIChatCompletionsResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: Array<{
		index: number;
		message: {
			role: 'assistant';
			content: string | null;
			reasoning_content?: string;
			tool_calls?: Array<{
				id: string;
				type: 'function';
				function: { name: string; arguments: string };
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
		prompt_tokens_details?: { cached_tokens?: number };
		completion_tokens_details?: { reasoning_tokens?: number };
	};
}

interface OpenAIStreamChunk {
	id?: string;
	choices?: Array<{
		index: number;
		delta: {
			role?: string;
			content?: string;
			reasoning_content?: string;
			tool_calls?: Array<{
				index: number;
				id?: string;
				function?: { name?: string; arguments?: string };
			}>;
		};
		finish_reason: string | null;
	}>;
	usage?: OpenAIChatCompletionsResponse['usage'];
}

// Helpers

async function* parseChatCompletionsStreamEvents(
	body: AsyncIterableIterator<Buffer | Uint8Array>,
): AsyncIterable<OpenAIStreamChunk> {
	for await (const message of parseSSEStream(body)) {
		if (!message.data) continue;
		if (message.data === '[DONE]') continue;

		try {
			yield JSON.parse(message.data) as OpenAIStreamChunk;
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (e) {
			// ignore malformed SSE frame
		}
	}
}

function genericMessagesToChatCompletionsInput(messages: Message[]): ChatCompletionsMessage[] {
	const result: ChatCompletionsMessage[] = [];

	for (const msg of messages) {
		if (msg.role === 'system') {
			const text = msg.content
				.filter((part) => part.type === 'text')
				.map((part) => part.text)
				.join('\n\n');
			if (text) result.push({ role: 'system', content: text });
			continue;
		}

		if (msg.role === 'user') {
			const text = msg.content
				.filter((part) => part.type === 'text')
				.map((part) => part.text)
				.join('\n\n');
			result.push({ role: 'user', content: text });
			continue;
		}

		if (msg.role === 'assistant') {
			let text = '';
			const toolCalls: ChatCompletionsMessage['tool_calls'] = [];
			for (const part of msg.content) {
				if (part.type === 'text' || part.type === 'reasoning') {
					text += part.text;
				} else if (part.type === 'tool-call') {
					if (!part.toolCallId) {
						throw new Error('Tool call ID is required');
					}
					toolCalls.push({
						id: part.toolCallId,
						type: 'function',
						function: { name: part.toolName, arguments: part.input },
					});
				}
			}
			result.push({
				role: 'assistant',
				content: text || null,
				...(toolCalls.length && { tool_calls: toolCalls }),
			});
			continue;
		}

		if (msg.role === 'tool') {
			for (const part of msg.content) {
				if (part.type === 'tool-result') {
					const output =
						typeof part.result === 'string' ? part.result : JSON.stringify(part.result);
					result.push({ role: 'tool', tool_call_id: part.toolCallId, content: output });
				}
			}
		}
	}

	return result;
}

/**
 * The SDK's `getParametersJsonSchema` gates its conversion on
 * `schema instanceof ZodSchema`, which silently fails across zod copies and
 * returns the raw zod object. Sending that as `parameters` gives the model a
 * meaningless schema, so it never calls the tool - convert what slipped through.
 */
function toParametersJsonSchema(tool: Exclude<Tool, { type: 'provider' }>): unknown {
	const parameters = getParametersJsonSchema(tool);
	return isZodLike(parameters) ? zodToJsonSchema(parameters) : parameters;
}

function genericToolToChatCompletionsTool(tool: Tool): OpenAIFunctionToolDef | null {
	if (tool.type === 'provider') {
		// Provider tools (e.g. web_search) aren't part of the `tools` array in Chat
		// Completions - they're enabled via request-level flags, see `getSearchFlag`.
		return null;
	}
	const parameters = toParametersJsonSchema(tool);
	return {
		type: 'function',
		function: {
			name: tool.name,
			description: tool.description,
			parameters,
			strict: tool.strict,
		},
	};
}

function parseChatCompletionMessage(message: OpenAIChatCompletionsResponse['choices'][0]['message']): {
	text: string;
	toolCalls: ToolCall[];
} {
	const toolCalls: ToolCall[] = [];
	for (const tc of message.tool_calls ?? []) {
		try {
			toolCalls.push({
				id: tc.id,
				name: tc.function.name,
				arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
				argumentsRaw: tc.function.arguments,
			});
			// eslint-disable-next-line @typescript-eslint/no-unused-vars
		} catch (e) {
			// No INode available in this parsing helper to build a NodeApiError; the
			// error propagates up through generate()/stream() to supplyData()'s caller.
			// eslint-disable-next-line @n8n/community-nodes/require-node-api-error
			throw new Error(`Failed to parse function call arguments: ${tc.function.arguments}`);
		}
	}
	return { text: message.content ?? '', toolCalls };
}

function parseTokenUsage(
	usage: OpenAIChatCompletionsResponse['usage'] | undefined,
): TokenUsage | undefined {
	return usage
		? {
				promptTokens: usage.prompt_tokens ?? 0,
				completionTokens: usage.completion_tokens ?? 0,
				totalTokens: usage.total_tokens ?? 0,
				inputTokenDetails: {
					...(!!usage.prompt_tokens_details?.cached_tokens && {
						cacheRead: usage.prompt_tokens_details.cached_tokens,
					}),
				},
				outputTokenDetails: {
					...(!!usage.completion_tokens_details?.reasoning_tokens && {
						reasoning: usage.completion_tokens_details.reasoning_tokens,
					}),
				},
			}
		: undefined;
}

function mapFinishReason(finishReason: string | null): FinishReason {
	switch (finishReason) {
		case 'stop':
			return 'stop';
		case 'length':
			return 'length';
		case 'tool_calls':
			return 'tool-calls';
		case 'content_filter':
			return 'content-filter';
		default:
			return 'other';
	}
}

export interface OpenAIChatModelConfig extends ChatModelConfig {
	apiKey?: string;
	baseURL?: string;

	providerTools?: ProviderTool[];

	/**
	 * Send `enable_thinking` on every request. Left `undefined` the field is
	 * omitted and the model keeps its own default - which for hybrid models
	 * (qwen-plus, qwen3-*) means thinking is on, and slow.
	 */
	enableThinking?: boolean;

	/** Cap on thinking tokens; only meaningful while thinking is enabled. */
	thinkingBudget?: number;

	/** Echo the exact request and raw response back through `providerMetadata`. */
	debug?: boolean;
}

export interface RequestConfig {
	httpRequest: (
		method: IHttpRequestMethods,
		url: string,
		body?: object,
		headers?: Record<string, string>,
	) => Promise<{ body: unknown }>;
	openStream: (
		method: IHttpRequestMethods,
		url: string,
		body?: object,
		headers?: Record<string, string>,
	) => Promise<{ body: AsyncIterableIterator<Buffer | Uint8Array> }>;
}

export class OpenAIChatModel extends BaseChatModel<OpenAIChatModelConfig> {
	private baseURL: string;

	constructor(
		modelId: string = 'qwen-plus',
		private requests: RequestConfig,
		config?: OpenAIChatModelConfig,
	) {
		super('openai', modelId, config);
		this.baseURL = config?.baseURL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
	}

	private getTools(config?: OpenAIChatModelConfig): OpenAIFunctionToolDef[] {
		const ownTools = this.tools;
		const providerTools = config?.providerTools ?? this.defaultConfig?.providerTools ?? [];
		return [...ownTools, ...providerTools]
			.map(genericToolToChatCompletionsTool)
			.filter((tool): tool is OpenAIFunctionToolDef => tool !== null);
	}

	private getSearchFlag(config?: OpenAIChatModelConfig): boolean {
		const providerTools = config?.providerTools ?? this.defaultConfig?.providerTools ?? [];
		return providerTools.some((tool) => tool.type === 'provider' && tool.name === 'web_search');
	}

	/**
	 * `mergeConfig` only knows the base config fields, so the Qwen-specific ones
	 * are resolved by hand: per-call config first, then the node-level default.
	 */
	private getThinking(config?: OpenAIChatModelConfig): {
		enableThinking?: boolean;
		thinkingBudget?: number;
	} {
		return {
			enableThinking: config?.enableThinking ?? this.defaultConfig?.enableThinking,
			thinkingBudget: config?.thinkingBudget ?? this.defaultConfig?.thinkingBudget,
		};
	}

	private buildRequestBody(
		messages: Message[],
		config: OpenAIChatModelConfig | undefined,
		overrides: {
			tools?: OpenAIFunctionToolDef[];
			responseFormat?: ResponseFormatJsonSchema;
			temperature?: number;
		} = {},
	): OpenAIChatCompletionsRequest {
		const merged = this.mergeConfig(config);
		const chatMessages = genericMessagesToChatCompletionsInput(messages);
		const tools = overrides.tools ?? this.getTools(config);
		const { enableThinking, thinkingBudget } = this.getThinking(config);

		return {
			model: this.modelId,
			messages: chatMessages,
			max_tokens: merged.maxTokens,
			temperature: overrides.temperature ?? merged.temperature,
			top_p: merged.topP,
			stop: merged.stopSequences,
			seed: merged.seed,
			presence_penalty: merged.presencePenalty,
			frequency_penalty: merged.frequencyPenalty,
			...(tools.length && { tools, parallel_tool_calls: true }),
			...(this.getSearchFlag(config) && { enable_search: true }),
			...(enableThinking !== undefined && { enable_thinking: enableThinking }),
			...(enableThinking && thinkingBudget !== undefined && { thinking_budget: thinkingBudget }),
			...(overrides.responseFormat && { response_format: overrides.responseFormat }),
		};
	}

	private buildResult(body: OpenAIChatCompletionsResponse): GenerateResult {
		const choice = body.choices[0];
		const { text, toolCalls } = parseChatCompletionMessage(choice.message);
		const usage = parseTokenUsage(body.usage);

		const content: MessageContent[] = [];
		if (choice.message.reasoning_content) {
			content.push({ type: 'reasoning', text: choice.message.reasoning_content });
		}
		for (const toolCall of toolCalls) {
			content.push({
				type: 'tool-call',
				toolCallId: toolCall.id,
				toolName: toolCall.name,
				input: toolCall.argumentsRaw ?? JSON.stringify(toolCall.arguments),
			});
		}
		if (text) content.push({ type: 'text', text });

		return {
			id: body.id,
			finishReason: mapFinishReason(choice.finish_reason),
			usage,
			message: { role: 'assistant', content, id: body.id },
			rawResponse: body,
			providerMetadata: {
				model_provider: 'openai',
				model: body.model,
				created: body.created,
				id: body.id,
				finish_reason: choice.finish_reason,
			},
		};
	}

	/**
	 * `providerMetadata` is the only part of a result that survives into the n8n
	 * log panel, so the debug echo rides along there rather than in `rawResponse`.
	 */
	private attachDebug(
		result: GenerateResult,
		request: OpenAIChatCompletionsRequest,
		rawResponse: unknown,
		config?: OpenAIChatModelConfig,
	): GenerateResult {
		// `mergeConfig` narrows to the base config, so read the flag directly.
		if (!(config?.debug ?? this.defaultConfig?.debug)) return result;
		return {
			...result,
			providerMetadata: {
				...result.providerMetadata,
				debug: { request, response: rawResponse },
			},
		};
	}

	async generate(messages: Message[], config?: OpenAIChatModelConfig): Promise<GenerateResult> {
		const requestBody = this.buildRequestBody(messages, config);
		const response = await this.requests.httpRequest(
			'POST',
			`${this.baseURL}/chat/completions`,
			requestBody,
		);
		const result = this.buildResult(response.body as OpenAIChatCompletionsResponse);
		return this.attachDebug(result, requestBody, response.body, config);
	}

	/**
	 * Same request/response pipeline as `generate`, but with `tools` stripped and
	 * `response_format` forced - used to coerce a final answer into a JSON Schema
	 * via provider-side constrained decoding, without letting the model call a tool.
	 */
	async generateStructured(
		messages: Message[],
		schema: Record<string, unknown>,
		config?: OpenAIChatModelConfig,
	): Promise<GenerateResult> {
		const requestBody = this.buildRequestBody(messages, config, {
			tools: [],
			temperature: 0,
			responseFormat: {
				type: 'json_schema',
				json_schema: { name: 'structured_output', schema, strict: true },
			},
		});
		const response = await this.requests.httpRequest(
			'POST',
			`${this.baseURL}/chat/completions`,
			requestBody,
		);
		const result = this.buildResult(response.body as OpenAIChatCompletionsResponse);
		return this.attachDebug(result, requestBody, response.body, config);
	}

	async *stream(messages: Message[], config?: OpenAIChatModelConfig): AsyncIterable<StreamChunk> {
		const requestBody = this.buildRequestBody(messages, config);
		requestBody.stream = true;
		requestBody.stream_options = { include_usage: true };

		const streamResponse = await this.requests.openStream(
			'POST',
			`${this.baseURL}/chat/completions`,
			requestBody,
		);

		const toolCallBuffers: Record<number, { id: string; name: string; arguments: string }> = {};
		let finishReason: string | null = null;
		let usage: OpenAIChatCompletionsResponse['usage'];

		for await (const chunk of parseChatCompletionsStreamEvents(streamResponse.body)) {
			if (chunk.usage) usage = chunk.usage;

			const choice = chunk.choices?.[0];
			if (!choice) continue;

			const delta = choice.delta;
			if (delta.content) {
				yield { type: 'text-delta', delta: delta.content };
			}
			if (delta.reasoning_content) {
				yield { type: 'reasoning-delta', delta: delta.reasoning_content };
			}
			for (const tc of delta.tool_calls ?? []) {
				const buf = (toolCallBuffers[tc.index] ??= { id: '', name: '', arguments: '' });
				if (tc.id) buf.id = tc.id;
				if (tc.function?.name) buf.name += tc.function.name;
				if (tc.function?.arguments) buf.arguments += tc.function.arguments;
			}
			if (choice.finish_reason) finishReason = choice.finish_reason;
		}

		if (finishReason === 'tool_calls') {
			for (const buf of Object.values(toolCallBuffers)) {
				yield {
					type: 'tool-call-delta',
					id: buf.id,
					name: buf.name,
					argumentsDelta: buf.arguments,
				};
			}
		}

		yield {
			type: 'finish',
			finishReason: mapFinishReason(finishReason),
			usage: parseTokenUsage(usage),
		};
	}
}
