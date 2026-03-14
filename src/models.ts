/**
 * RobinPath CLI — AI model definitions, pricing, usage tracking
 */

// ============================================================================
// Interfaces
// ============================================================================

export interface UsageTracker {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    requests: number;
    cost: number;
}

export interface ModelPricing {
    input: number;
    output: number;
}

export interface ModelInfo {
    group: string;
    id: string;
    name: string;
    desc: string;
    requiresKey: boolean;
}

// ============================================================================
// Usage tracking
// ============================================================================

export function createUsageTracker(): UsageTracker {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0, cost: 0 };
}

// ============================================================================
// Model pricing — prices per 1M tokens (USD)
// ============================================================================

export const MODEL_PRICING: Record<string, ModelPricing> = {
    'anthropic/claude-sonnet-4.6': { input: 3.00, output: 15.00 },
    'anthropic/claude-opus-4.6': { input: 15.00, output: 75.00 },
    'anthropic/claude-haiku-4.5': { input: 0.80, output: 4.00 },
    'openai/gpt-5.2': { input: 2.00, output: 8.00 },
    'openai/gpt-5.2-pro': { input: 10.00, output: 40.00 },
    'openai/gpt-5-mini': { input: 0.40, output: 1.60 },
    'google/gemini-3-flash-preview': { input: 0.10, output: 0.40 },
    'google/gemini-3.1-pro-preview': { input: 1.25, output: 5.00 },
    'robinpath-default': { input: 0, output: 0 },
};

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING[model?.split(':')[0]];
    if (!pricing) return 0;
    return (promptTokens / 1_000_000) * pricing.input + (completionTokens / 1_000_000) * pricing.output;
}

// ============================================================================
// Available AI models (synced with Platform)
// ============================================================================

export const AI_MODELS: ModelInfo[] = [
    { group: 'Free', id: 'robinpath-default', name: 'Gemini 2.0 Flash', desc: 'free, no key needed', requiresKey: false },
    { group: 'Anthropic', id: 'anthropic/claude-sonnet-4.6', name: 'Claude Sonnet 4.6', desc: 'fast + smart', requiresKey: true },
    { group: 'Anthropic', id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', desc: 'most capable', requiresKey: true },
    { group: 'Anthropic', id: 'anthropic/claude-haiku-4.5', name: 'Claude Haiku 4.5', desc: 'fastest + cheapest', requiresKey: true },
    { group: 'OpenAI', id: 'openai/gpt-5.2', name: 'GPT-5.2', desc: 'instant', requiresKey: true },
    { group: 'OpenAI', id: 'openai/gpt-5.2-pro', name: 'GPT-5.2 Pro', desc: 'reasoning', requiresKey: true },
    { group: 'OpenAI', id: 'openai/gpt-5-mini', name: 'GPT-5 mini', desc: 'budget-friendly', requiresKey: true },
    { group: 'Google', id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', desc: '1M context', requiresKey: true },
    { group: 'Google', id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', desc: '65K output', requiresKey: true },
];
