import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { getModel, PROVIDERS, validateBaseUrl } from '../utils/models.js';

const CALL_TIMEOUT_MS = 60_000; // 60 seconds per API call

// Client cache - keyed by provider+key suffix to avoid recreating for every call
const clients = {};

// Deduplication - each warning key fires at most once per process lifetime
const _warnedOnce = new Set();
function warnOnce(key, message) {
  if (_warnedOnce.has(key)) return;
  _warnedOnce.add(key);
  console.error(`  ${message}`);
}

function getAnthropicClient(apiKey) {
  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY not set.\n' +
      '  Option 1: schemalock config set ANTHROPIC_API_KEY sk-ant-...\n' +
      '  Option 2: export ANTHROPIC_API_KEY=sk-ant-... in your shell\n' +
      '  Option 3: add ANTHROPIC_API_KEY=sk-ant-... to a .env file here',
    );
  }
  const cacheKey = `anthropic:${key.slice(-8)}`;
  if (!clients[cacheKey]) clients[cacheKey] = new Anthropic({ apiKey: key });
  return clients[cacheKey];
}

function getOpenAICompatibleClient(provider, apiKey, baseUrl) {
  const providerInfo = PROVIDERS[provider] || PROVIDERS.custom;
  const envKey       = providerInfo.envKey;
  const defaultBase  = providerInfo.baseUrl;
  const key          = apiKey || (envKey ? process.env[envKey] : null);
  const resolvedBase = baseUrl || defaultBase;

  // Ollama runs locally and doesn't need an API key
  if (!key && provider !== 'ollama' && provider !== 'custom') {
    const keyName = envKey || 'OPENAI_API_KEY';
    throw new Error(
      `${keyName} not set.\n` +
      `  Option 1: schemalock config set ${keyName} your-key\n` +
      `  Option 2: export ${keyName}=your-key in your shell`,
    );
  }

  const cacheKey = `${provider}:${(key || 'none').slice(-8)}:${resolvedBase || ''}`;
  if (!clients[cacheKey]) {
    clients[cacheKey] = new OpenAI({
      apiKey: key || 'ollama', // Ollama accepts any non-empty string
      ...(resolvedBase ? { baseURL: resolvedBase } : {}),
    });
  }
  return clients[cacheKey];
}

function withTimeout(promise, ms, label) {
  const timer = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s (${label})`)), ms),
  );
  return Promise.race([promise, timer]);
}

export async function runLLM({ modelId, systemPrompt, userInput, maxTokens = 1024, baseUrl, apiKey }) {
  // M3: Warn about insecure base URLs (once per unique URL per process)
  const urlWarning = validateBaseUrl(baseUrl);
  if (urlWarning) warnOnce(`base-url:${baseUrl}`, urlWarning);

  const model = getModel(modelId, baseUrl);
  if (!model) {
    throw new Error(
      `Unknown model: '${modelId}'.\n` +
      `  Run: schemalock list --models\n` +
      `  Custom endpoint: add --base-url https://your-endpoint/v1`,
    );
  }

  // H4: Warn that cost estimates are unavailable for unknown custom models (once per model)
  if (model._isCustom) {
    warnOnce(`custom-model:${modelId}`, `Note: '${modelId}' is an unknown model - cost estimates will show $0.`);
  }

  // Anthropic rejects empty string system prompts - normalize to undefined
  const system   = systemPrompt?.trim() || undefined;
  const provider = model.provider;
  const start    = Date.now();

  // --- Anthropic ---
  if (provider === 'anthropic') {
    const client = getAnthropicClient(apiKey);
    const response = await withTimeout(
      client.messages.create({
        model: modelId,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: userInput }],
      }),
      CALL_TIMEOUT_MS,
      modelId,
    );
    return {
      output:       response.content[0]?.type === 'text' ? response.content[0].text : '',
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      latencyMs:    Date.now() - start,
    };
  }

  // --- OpenAI + all OpenAI-compatible providers (Groq, Ollama, Mistral, Together, Fireworks, custom) ---
  const client   = getOpenAICompatibleClient(provider, apiKey, baseUrl);
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: userInput });

  // Ollama model names drop the "ollama/" prefix when calling the API
  const resolvedModelId = modelId.startsWith('ollama/') ? modelId.slice('ollama/'.length) : modelId;

  const response = await withTimeout(
    client.chat.completions.create({ model: resolvedModelId, max_tokens: maxTokens, messages }),
    CALL_TIMEOUT_MS,
    modelId,
  );

  return {
    output:       response.choices[0]?.message?.content || '',
    inputTokens:  response.usage?.prompt_tokens     || 0,
    outputTokens: response.usage?.completion_tokens || 0,
    latencyMs:    Date.now() - start,
  };
}
