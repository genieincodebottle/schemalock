import { existsSync, readFileSync } from 'fs';
import { MODELS_PATH } from './config.js';

// Pricing in USD per 1M tokens - verify at provider pricing pages
// Anthropic: https://www.anthropic.com/pricing
// OpenAI:    https://openai.com/api/pricing
// Groq:      https://console.groq.com/settings/billing
// Mistral:   https://mistral.ai/technology/#pricing
// H3: Users can override any price in ~/.schemalock/models.json
//     Run: schemalock config update-pricing  to create an editable template

export const PROVIDERS = {
  anthropic: { sdk: 'anthropic', envKey: 'ANTHROPIC_API_KEY',  baseUrl: null },
  openai:    { sdk: 'openai',    envKey: 'OPENAI_API_KEY',     baseUrl: null },
  groq:      { sdk: 'openai',    envKey: 'GROQ_API_KEY',       baseUrl: 'https://api.groq.com/openai/v1' },
  ollama:    { sdk: 'openai',    envKey: null,                  baseUrl: 'http://localhost:11434/v1' },
  mistral:   { sdk: 'openai',    envKey: 'MISTRAL_API_KEY',    baseUrl: 'https://api.mistral.ai/v1' },
  together:  { sdk: 'openai',    envKey: 'TOGETHER_API_KEY',   baseUrl: 'https://api.together.xyz/v1' },
  fireworks: { sdk: 'openai',    envKey: 'FIREWORKS_API_KEY',  baseUrl: 'https://api.fireworks.ai/inference/v1' },
  custom:    { sdk: 'openai',    envKey: null,                  baseUrl: null },
};

// Base pricing - treated as defaults, can be overridden via ~/.schemalock/models.json
const MODELS_BASE = {
  // --- Anthropic ---
  'claude-sonnet-4-6':       { provider: 'anthropic', inputCost: 3.00,  outputCost: 15.00, maxTokens: 64000  },
  'claude-opus-4-6':         { provider: 'anthropic', inputCost: 15.00, outputCost: 75.00, maxTokens: 32000  },
  'claude-haiku-4-5':        { provider: 'anthropic', inputCost: 0.80,  outputCost: 4.00,  maxTokens: 64000  },

  // --- OpenAI ---
  'gpt-4o':                  { provider: 'openai',    inputCost: 2.50,  outputCost: 10.00, maxTokens: 16384  },
  'gpt-4o-mini':             { provider: 'openai',    inputCost: 0.15,  outputCost: 0.60,  maxTokens: 16384  },
  'gpt-4-turbo':             { provider: 'openai',    inputCost: 10.00, outputCost: 30.00, maxTokens: 4096   },
  'o1':                      { provider: 'openai',    inputCost: 15.00, outputCost: 60.00, maxTokens: 100000 },
  'o1-mini':                 { provider: 'openai',    inputCost: 3.00,  outputCost: 12.00, maxTokens: 65536  },
  'o3-mini':                 { provider: 'openai',    inputCost: 1.10,  outputCost: 4.40,  maxTokens: 100000 },

  // --- Groq (OpenAI-compatible, very fast inference) ---
  'llama-3.3-70b-versatile': { provider: 'groq',      inputCost: 0.59,  outputCost: 0.79,  maxTokens: 32768  },
  'llama-3.1-8b-instant':    { provider: 'groq',      inputCost: 0.05,  outputCost: 0.08,  maxTokens: 8000   },
  'mixtral-8x7b-32768':      { provider: 'groq',      inputCost: 0.24,  outputCost: 0.24,  maxTokens: 32768  },
  'gemma2-9b-it':            { provider: 'groq',      inputCost: 0.20,  outputCost: 0.20,  maxTokens: 8192   },

  // --- Mistral ---
  'mistral-large-latest':    { provider: 'mistral',   inputCost: 2.00,  outputCost: 6.00,  maxTokens: 128000 },
  'mistral-small-latest':    { provider: 'mistral',   inputCost: 0.10,  outputCost: 0.30,  maxTokens: 32000  },

  // --- Ollama (local, zero cost) ---
  'ollama/llama3.2':         { provider: 'ollama',    inputCost: 0,     outputCost: 0,     maxTokens: 128000 },
  'ollama/mistral':          { provider: 'ollama',    inputCost: 0,     outputCost: 0,     maxTokens: 32000  },
  'ollama/phi4':             { provider: 'ollama',    inputCost: 0,     outputCost: 0,     maxTokens: 16000  },
  'ollama/qwen2.5':          { provider: 'ollama',    inputCost: 0,     outputCost: 0,     maxTokens: 128000 },
};

// H3: Load user pricing overrides from ~/.schemalock/models.json
// This allows users to update stale prices without waiting for a schemalock release.
function loadPricingOverrides() {
  try {
    if (!existsSync(MODELS_PATH)) return {};
    const raw = JSON.parse(readFileSync(MODELS_PATH, 'utf-8'));
    // Validate it's an object with model entries
    if (typeof raw !== 'object' || Array.isArray(raw)) return {};
    return raw;
  } catch {
    return {};
  }
}

// Merge base models with user overrides (user wins on any field)
const overrides = loadPricingOverrides();
export const MODELS = { ...MODELS_BASE };
for (const [id, data] of Object.entries(overrides)) {
  if (typeof data === 'object' && !Array.isArray(data)) {
    MODELS[id] = MODELS[id] ? { ...MODELS[id], ...data } : data;
  }
}

// Generate a template models.json so users can edit prices
export function buildPricingTemplate() {
  const out = {};
  for (const [id, m] of Object.entries(MODELS_BASE)) {
    out[id] = { inputCost: m.inputCost, outputCost: m.outputCost };
  }
  return out;
}

// H4: Returns model info or null. If unknown but baseUrl given, returns a custom placeholder
// with a warning flag so callers can inform users cost estimates are unavailable.
export function getModel(modelId, baseUrl) {
  if (MODELS[modelId]) return { ...MODELS[modelId], _isKnown: true };
  if (baseUrl) {
    return {
      provider: 'custom', inputCost: 0, outputCost: 0,
      maxTokens: 200000, _isKnown: false, _isCustom: true,
    };
  }
  return null;
}

export function getProvider(providerId) {
  return PROVIDERS[providerId] || null;
}

// M3: Validate that a custom base URL looks safe
export function validateBaseUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1' || parsed.hostname.endsWith('.local');
    if (!isLocal && parsed.protocol !== 'https:') {
      return `Warning: --base-url '${url}' uses ${parsed.protocol} (not HTTPS). API keys sent over this connection are NOT encrypted.`;
    }
    return null;
  } catch {
    return `Warning: --base-url '${url}' does not appear to be a valid URL.`;
  }
}

// Zero cost for local/free models - no misleading "$0.0000" noise
export function estimateCost(modelId, inputTokens, outputTokens) {
  const model = MODELS[modelId];
  if (!model || model.inputCost === 0) {
    return { inputCost: 0, outputCost: 0, total: 0, free: true };
  }
  const inputCost  = (inputTokens  / 1_000_000) * model.inputCost;
  const outputCost = (outputTokens / 1_000_000) * model.outputCost;
  return { inputCost, outputCost, total: inputCost + outputCost, free: false };
}

// Cap requested tokens to model's hard limit to avoid API errors
export function clampMaxTokens(modelId, requested) {
  const model = MODELS[modelId];
  if (!model) return requested;
  return Math.min(requested, model.maxTokens);
}
