# @aibus/n8n-nodes-qwen-model

This is an n8n community node. It lets you use _app/service name_ in your n8n workflows.

_App/service name_ is _one or two sentences describing the service this node integrates with_.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/sustainable-use-license/) workflow automation platform.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation.

## Operations

_List the operations supported by your node._

## Credentials

_If users need to authenticate with the app/service, provide details here. You should include prerequisites (such as signing up with the service), available authentication methods, and how to set them up._

## Compatibility

_State the minimum n8n version, as well as which versions you test against. You can also include any known version incompatibility issues._

## Usage

Works with any OpenAI-compatible Chat Completions endpoint (Qwen DashScope by default; set the credential Base URL for others). Qwen-only options (`enable_search`, `enable_thinking`, `thinking_budget`) are sent only when set.

Token usage: n8n's own tracing keeps only prompt/completion counts, so each generation's `generationInfo` also carries
- `usage`: the provider's raw usage (incl. `prompt_tokens_details.cached_tokens`, `completion_tokens_details.reasoning_tokens`), also on streamed responses;
- `promptCache`: prompt-cache summary (`promptTokens`, `cachedTokens`, `uncachedTokens`, ...), non-streamed responses only.

These are stored in the saved execution data, so tools reading executions can price cached/reasoning tokens.

## Resources

* [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
* _Link to app/service documentation._

## Version history

_This is another optional section. If your node has multiple versions, include a short description of available versions and what changed, as well as any compatibility impact._
