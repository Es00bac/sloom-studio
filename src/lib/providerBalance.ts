import type { ApiKeys } from '../types/flow';

export type ProviderBalanceStatus = 'available' | 'unconfigured' | 'unsupported' | 'error';

export interface ProviderBalance {
  provider: 'bfl' | 'stability' | 'gemini' | 'openai' | 'huggingface';
  label: string;
  status: ProviderBalanceStatus;
  checkedAt: number;
  credits?: number;
  estimatedUsd?: number;
  message?: string;
}

type BalanceApiKeys = Pick<ApiKeys, 'bfl' | 'stability'> & Partial<Pick<ApiKeys, 'gemini' | 'openai' | 'huggingface'>>;

const CREDIT_USD = 0.01;

export async function refreshProviderBalances(apiKeys: BalanceApiKeys): Promise<ProviderBalance[]> {
  const checkedAt = Date.now();
  const [bfl, stability] = await Promise.all([
    fetchBflBalance(apiKeys.bfl, checkedAt),
    fetchStabilityBalance(apiKeys.stability, checkedAt),
  ]);

  return [
    bfl,
    stability,
    unsupportedBalance('gemini', 'Google Gemini / Vertex', checkedAt, 'Google Cloud does not expose a simple remaining-credit balance from a Gemini/Vertex image API key. Use Cloud Billing budgets/alerts for account-level spend.'),
    unsupportedBalance('openai', 'OpenAI', checkedAt, 'OpenAI does not expose a supported browser-safe remaining-credit API for this app. Use the platform usage dashboard and project budgets.'),
    unsupportedBalance('huggingface', 'Hugging Face', checkedAt, 'Hugging Face Inference Provider credit/billing data is provider-routed and not available from a simple in-app balance endpoint.'),
  ];
}

async function fetchBflBalance(apiKey: string | undefined, checkedAt: number): Promise<ProviderBalance> {
  if (!apiKey?.trim()) {
    return unconfiguredBalance('bfl', 'Black Forest Labs', checkedAt);
  }
  try {
    const response = await fetch('https://api.bfl.ai/v1/credits', {
      headers: {
        accept: 'application/json',
        'x-key': apiKey.trim(),
      },
    });
    if (!response.ok) {
      throw new Error(`BFL balance check failed with HTTP ${response.status}.`);
    }
    const payload = await response.json() as { credits?: unknown };
    return creditBalance('bfl', 'Black Forest Labs', checkedAt, payload.credits);
  } catch (error) {
    return errorBalance('bfl', 'Black Forest Labs', checkedAt, error);
  }
}

async function fetchStabilityBalance(apiKey: string | undefined, checkedAt: number): Promise<ProviderBalance> {
  if (!apiKey?.trim()) {
    return unconfiguredBalance('stability', 'Stability AI', checkedAt);
  }
  try {
    const response = await fetch('https://api.stability.ai/v1/user/balance', {
      headers: {
        accept: 'application/json',
        Authorization: `Bearer ${apiKey.trim()}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Stability balance check failed with HTTP ${response.status}.`);
    }
    const payload = await response.json() as { credits?: unknown };
    return creditBalance('stability', 'Stability AI', checkedAt, payload.credits);
  } catch (error) {
    return errorBalance('stability', 'Stability AI', checkedAt, error);
  }
}

function creditBalance(
  provider: ProviderBalance['provider'],
  label: string,
  checkedAt: number,
  rawCredits: unknown,
): ProviderBalance {
  const credits = typeof rawCredits === 'number' && Number.isFinite(rawCredits) ? rawCredits : undefined;
  if (credits === undefined) {
    return {
      provider,
      label,
      status: 'error',
      checkedAt,
      message: 'Balance response did not include numeric credits.',
    };
  }
  return {
    provider,
    label,
    status: 'available',
    checkedAt,
    credits,
    estimatedUsd: Math.round(credits * CREDIT_USD * 1_000_000) / 1_000_000,
  };
}

function unconfiguredBalance(
  provider: ProviderBalance['provider'],
  label: string,
  checkedAt: number,
): ProviderBalance {
  return {
    provider,
    label,
    status: 'unconfigured',
    checkedAt,
    message: 'Add an API key in Settings to check this provider.',
  };
}

function unsupportedBalance(
  provider: ProviderBalance['provider'],
  label: string,
  checkedAt: number,
  message: string,
): ProviderBalance {
  return {
    provider,
    label,
    status: 'unsupported',
    checkedAt,
    message,
  };
}

function errorBalance(
  provider: ProviderBalance['provider'],
  label: string,
  checkedAt: number,
  error: unknown,
): ProviderBalance {
  return {
    provider,
    label,
    status: 'error',
    checkedAt,
    message: error instanceof Error ? error.message : 'Balance check failed.',
  };
}
