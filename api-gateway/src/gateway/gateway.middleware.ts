import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RateLimiterService } from '../rate-limiter/rate-limiter.service';
import { ConfigSubscriberService } from '../config/config-subscriber.service';
import { MetricsService } from '../metrics/metrics.service';
import {
  ROUTE_REGISTRY,
  RouteDefinition,
  DEFAULT_RATE_LIMITS,
  RefillRateUnit,
} from './route-config';

@Injectable()
export class GatewayRateLimitMiddleware implements NestMiddleware {
  private readonly logger = new Logger(GatewayRateLimitMiddleware.name);

  constructor(
    private readonly rateLimiter: RateLimiterService,
    private readonly configSubscriber: ConfigSubscriberService,
    private readonly metricsService: MetricsService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const routeConfig = this.matchRoute(req.method, req.path);
    if (!routeConfig) {
      return next();
    }

    const userId = (req.headers['x-user-id'] as string) || 'anonymous';
    const endpoint = routeConfig.endpoint;

    const dynamicConfig = this.configSubscriber.getLimits(endpoint);
    const defaults = DEFAULT_RATE_LIMITS[endpoint];
    const maxTokens = dynamicConfig?.maxTokens ?? defaults?.maxTokens ?? 10;
    const rawRefillRate = dynamicConfig?.refillRate ?? defaults?.refillRate ?? 5;
    const refillRateUnit: RefillRateUnit =
      dynamicConfig?.refillRateUnit ?? defaults?.refillRateUnit ?? 'second';
    const refillRate = this.normalizeToPerSecond(rawRefillRate, refillRateUnit);
    const windowSizeMs =
      dynamicConfig?.windowSizeMs ?? defaults?.windowSizeMs ?? 60000;

    const algorithm =
      (req.headers['x-rate-limit-algo'] as string) || 'token-bucket';

    const stopTimer = this.metricsService.startTimer(endpoint);

    let result;
    if (algorithm === 'sliding-window') {
      result = await this.rateLimiter.checkSlidingWindow(
        userId,
        endpoint,
        maxTokens,
        windowSizeMs,
      );
    } else {
      result = await this.rateLimiter.checkTokenBucket(
        userId,
        endpoint,
        maxTokens,
        refillRate,
      );
    }

    stopTimer();
    this.metricsService.recordHit(endpoint);

    if (!result.allowed) {
      this.metricsService.recordRejection(endpoint);
      res.setHeader('X-RateLimit-Limit', maxTokens);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Algorithm', algorithm);
      res.setHeader('Retry-After', Math.ceil(result.retryAfterMs / 1000));
      res.status(429).json({
        statusCode: 429,
        message: 'Rate limit exceeded',
        retryAfterMs: result.retryAfterMs,
      });
      return;
    }

    req['rateLimitHeaders'] = {
      'X-RateLimit-Limit': maxTokens,
      'X-RateLimit-Remaining': result.remaining,
      'X-RateLimit-Algorithm': algorithm,
      'X-RateLimit-RefillRate': `${rawRefillRate}/${refillRateUnit}`,
    };

    next();
  }

  private normalizeToPerSecond(rate: number, unit: RefillRateUnit): number {
    switch (unit) {
      case 'minute':
        return rate / 60;
      case 'hour':
        return rate / 3600;
      default:
        return rate;
    }
  }

  private matchRoute(
    method: string,
    path: string,
  ): RouteDefinition | undefined {
    const normalizedPath = path.replace(/\/+$/, '');
    return ROUTE_REGISTRY.find(
      (route) =>
        route.method === method.toUpperCase() &&
        route.path === normalizedPath,
    );
  }
}
