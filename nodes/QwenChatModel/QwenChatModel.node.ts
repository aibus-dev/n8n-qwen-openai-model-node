import type {
	INodeType,
	INodeTypeDescription,
	ISupplyDataFunctions,
	IDataObject,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { ProviderTool, supplyModel } from '@n8n/ai-node-sdk';
import { OpenAIChatModel, type RequestConfig } from './model';
import { StructuredOutputChatModel, parseStructuredOutputSchema } from './structuredOutput';
import { qwenChatModelProperties } from './properties';
import { formatBuiltInTools } from './common';
import { exposeMetadataInLogPanel } from './exposeMetadata';

type ModelOptions = {
	temperature?: number;
	maxTokens?: number;
	timeout?: number;
	enableThinking?: boolean;
	thinkingBudget?: number;
	debug?: boolean;
};

export class QwenChatModel implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Qwen Chat Model',
		name: 'qwenChatModel',
		icon: {
			light: 'file:../../icons/qwen.svg',
			dark: 'file:../../icons/qwen.dark.svg',
		},
		group: ['transform'],
		version: [1],
		subtitle: '={{$parameter["model"]}}',
		description: 'Chat Model backed by Qwen Cloud (DashScope) or any OpenAI-compatible endpoint',
		defaults: {
			name: 'Qwen Chat Model',
		},
		codex: {
			categories: ['assistant'],
			subcategories: {
				AI: ['Language Models', 'Root Nodes'],
				'Language Models': ['Chat Models (Recommended)'],
			},
			resources: {
				primaryDocumentation: [],
			},
		},

		inputs: [],

		outputs: [NodeConnectionTypes.AiLanguageModel],
		outputNames: ['Model'],
		credentials: [
			{
				name: 'qwenApi',
				required: true,
			},
		],
		requestDefaults: {
			ignoreHttpStatusErrors: true,
			baseURL:
				'={{ $credentials?.baseUrl?.split("/").slice(0,-1).join("/") || "https://dashscope-intl.aliyuncs.com/compatible-mode" }}',
		},
		properties: qwenChatModelProperties,
	};

	async supplyData(this: ISupplyDataFunctions, itemIndex: number) {
		const credentials = await this.getCredentials('qwenApi');
		const modelName = this.getNodeParameter('model', itemIndex) as string;
		const options = this.getNodeParameter('options', itemIndex, {}) as ModelOptions;
		const structuredOutputEnabled = this.getNodeParameter(
			'structuredOutput',
			itemIndex,
			false,
		) as boolean;

		const providerTools: ProviderTool[] = [];
		const builtInToolsParams = formatBuiltInTools(
			this.getNodeParameter('builtInTools', itemIndex, {}) as IDataObject,
		);
		if (builtInToolsParams.length) {
			providerTools.push(...builtInToolsParams);
		}

		const requests: RequestConfig = {
			httpRequest: async (method, url, body, headers) => {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'qwenApi',
					{
						url,
						method,
						body,
						headers,
						timeout: options.timeout,
					},
				);
				return {
					body: response,
				};
			},
			openStream: async (method, url, body, headers) => {
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					'qwenApi',
					{
						method,
						url,
						body,
						headers,
						timeout: options.timeout,
						encoding: 'stream',
					},
				);
				return {
					body: response,
				};
			},
		};

		const modelConfig = {
			baseURL: credentials.baseUrl as string,
			providerTools,
			temperature: options.temperature,
			maxTokens: options.maxTokens,
			timeout: options.timeout,
			enableThinking: options.enableThinking,
			thinkingBudget: options.thinkingBudget,
			debug: options.debug,
		};

		let model: OpenAIChatModel;
		if (structuredOutputEnabled) {
			const jsonSchemaParam = this.getNodeParameter('jsonSchema', itemIndex) as string;
			let schema: Record<string, unknown>;
			try {
				schema = parseStructuredOutputSchema(jsonSchemaParam);
			} catch (error) {
				throw new NodeOperationError(
					this.getNode(),
					`Invalid JSON Schema: ${error instanceof Error ? error.message : String(error)}`,
					{ itemIndex },
				);
			}
			model = new StructuredOutputChatModel(modelName, requests, modelConfig, schema);
		} else {
			model = new OpenAIChatModel(modelName, requests, modelConfig);
		}

		const supplied = supplyModel(this, model);
		exposeMetadataInLogPanel(supplied.response as object);
		return supplied;
	}
}
