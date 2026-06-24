export interface RouteDefinition {
  method: string;
  path: string;
  endpoint: string;
}

export const ROUTE_REGISTRY: RouteDefinition[] = [
  { method: 'POST', path: '/order', endpoint: 'order' },
  { method: 'GET', path: '/products', endpoint: 'products' },
  { method: 'POST', path: '/checkout', endpoint: 'checkout' },
];

export type RefillRateUnit = 'second' | 'minute' | 'hour';

export interface RateLimitDefaults {
  maxTokens: number;
  refillRate: number;
  refillRateUnit: RefillRateUnit;
  windowSizeMs: number;
}

export const DEFAULT_RATE_LIMITS: Record<string, RateLimitDefaults> = {
  order: { maxTokens: 5, refillRate: 1, refillRateUnit: 'second', windowSizeMs: 60000 },
  products: { maxTokens: 20, refillRate: 5, refillRateUnit: 'second', windowSizeMs: 60000 },
  checkout: { maxTokens: 3, refillRate: 1, refillRateUnit: 'second', windowSizeMs: 60000 },
};

export function getRegisteredEndpoints(): string[] {
  return ROUTE_REGISTRY.map((r) => r.endpoint);
}
