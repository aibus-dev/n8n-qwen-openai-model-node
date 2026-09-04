import type { INodeProperties } from 'n8n-workflow';

export const qwenChatModelProperties: INodeProperties[] = [
	{
		displayName: 'Model',
		name: 'model',
		type: 'options',
		description:
			'The Qwen (or OpenAI-compatible) model which will generate the completion. <a href="https://help.aliyun.com/zh/model-studio/getting-started/models">Learn more</a>.',
		typeOptions: {
			loadOptions: {
				routing: {
					request: {
						method: 'GET',
						url: '={{ $parameter.options?.baseURL?.split("/").slice(-1).pop() || $credentials?.baseUrl?.split("/").slice(-1).pop() || "v1" }}/models',
					},
					output: {
						postReceive: [
							{
								type: 'rootProperty',
								properties: {
									property: 'data',
								},
							},
							{
								type: 'setKeyValue',
								properties: {
									name: '={{$responseItem.id}}',
									value: '={{$responseItem.id}}',
								},
							},
							{
								type: 'sort',
								properties: {
									key: 'name',
								},
							},
						],
					},
				},
			},
		},
		routing: {
			send: {
				type: 'body',
				property: 'model',
			},
		},
		default: 'qwen-plus',
	},
	{
		displayName: 'Structured Output',
		name: 'structuredOutput',
		type: 'boolean',
		default: false,
		description:
			'Whether to force the final answer (not tool calls) to match a JSON Schema you provide, retrying/repairing the model output as needed',
	},
	{
		displayName: 'JSON Schema',
		name: 'jsonSchema',
		type: 'json',
		default:
			'{\n  "type": "object",\n  "properties": {\n    "answer": { "type": "string" }\n  },\n  "required": ["answer"],\n  "additionalProperties": false\n}',
		description: 'JSON Schema the final answer must match',
		displayOptions: {
			show: {
				structuredOutput: [true],
			},
		},
	},
	{
		displayName: 'Built-in Tools',
		name: 'builtInTools',
		placeholder: 'Add Built-in Tool',
		type: 'collection',
		default: {},
		options: [
			{
				displayName: 'Web Search',
				name: 'webSearch',
				type: 'collection',
				default: { searchContextSize: 'medium' },
				options: [
					{
						displayName: 'City',
						name: 'city',
						type: 'string',
						default: '',
						placeholder: 'e.g. New York, London',
					},
					{
						displayName: 'Country',
						name: 'country',
						type: 'string',
						default: '',
						placeholder: 'e.g. US, GB',
					},
					{
						displayName: 'Region',
						name: 'region',
						type: 'string',
						default: '',
						placeholder: 'e.g. New York, London',
					},
					{
						displayName: 'Search Context Size',
						name: 'searchContextSize',
						type: 'options',
						default: 'medium',
						description:
							'High level guidance for the amount of context window space to use for the search',
						options: [
							{ name: 'Low', value: 'low' },
							{ name: 'Medium', value: 'medium' },
							{ name: 'High', value: 'high' },
						],
					},
					{
						displayName: 'Web Search Allowed Domains',
						name: 'allowedDomains',
						type: 'string',
						default: '',
						description:
							'Comma-separated list of domains to search. Only domains in this list will be searched.',
						placeholder: 'e.g. google.com, wikipedia.org',
					},
				],
			},
		],
	},
	{
		displayName: 'Options',
		name: 'options',
		placeholder: 'Add Option',
		description: 'Additional options to add',
		type: 'collection',
		default: {},
		options: [
			{
				displayName: 'Enable Thinking',
				name: 'enableThinking',
				default: false,
				description:
					'Whether to let the model reason before answering. Hybrid models (e.g. qwen-plus, qwen3-*) think by default, which is much slower - add this option and leave it off to disable it. Leave the option out entirely to keep the model\'s own default. Note: some models only accept thinking on streamed requests, and thinking-only models (e.g. qwen3-*-thinking) reject turning it off.',
				type: 'boolean',
			},
			{
				displayName: 'Include Request and Response',
				name: 'debug',
				default: false,
				description:
					'Whether to attach the exact request sent to the model (messages, tool definitions, parameters) and the raw response to this node\'s output, so they can be inspected in the log panel. Leave off in production: it makes every run store the full prompt.',
				type: 'boolean',
			},
			{
				displayName: 'Max Tokens',
				name: 'maxTokens',
				default: 1024,
				typeOptions: { minValue: 1 },
				description: 'The maximum number of tokens to generate in the completion',
				type: 'number',
			},
			{
				displayName: 'Sampling Temperature',
				name: 'temperature',
				default: 0.7,
				typeOptions: { maxValue: 2, minValue: 0, numberPrecision: 1 },
				description:
					'Controls randomness: Lowering results in less random completions. As the temperature approaches zero, the model will become deterministic and repetitive.',
				type: 'number',
			},
			{
				displayName: 'Thinking Budget',
				name: 'thinkingBudget',
				default: 1024,
				typeOptions: { minValue: 1 },
				description:
					'Maximum number of tokens the model may spend on thinking. Only applies when thinking is enabled.',
				type: 'number',
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				default: 60000,
				typeOptions: { minValue: 1 },
				description: 'Time in ms to wait for the API response before timing out',
				type: 'number',
			},
		],
	},
];
