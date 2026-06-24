import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { getRegisteredEndpoints } from '../gateway/route-config';

export type RefillRateUnit = 'second' | 'minute' | 'hour';

export interface EndpointLimits {
  maxTokens: number;
  refillRate: number;
  refillRateUnit: RefillRateUnit;
  windowSizeMs: number;
}

@Injectable()
export class ConfigSubscriberService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfigSubscriberService.name);
  private subscriber: Redis;
  private redis: Redis;
  private limitsCache = new Map<string, EndpointLimits>();

  async onModuleInit() {
    const redisOpts = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    };

    this.redis = new Redis(redisOpts);
    this.subscriber = new Redis(redisOpts);

    await this.loadAllLimits();

    this.subscriber.subscribe('rate-limit-config', (err) => {
      if (err) {
        this.logger.error('Failed to subscribe to config channel', err);
        return;
      }
      this.logger.log('Subscribed to rate-limit-config channel');
    });

    this.subscriber.on('message', async (channel, message) => {
      if (channel === 'rate-limit-config') {
        this.logger.log(`Config update received: ${message}`);
        const { endpoint } = JSON.parse(message);
        await this.loadLimitsForEndpoint(endpoint);
      }
    });
  }

  private async loadAllLimits() {
    const endpoints = getRegisteredEndpoints();
    for (const ep of endpoints) {
      await this.loadLimitsForEndpoint(ep);
    }
  }

  private async loadLimitsForEndpoint(endpoint: string) {
    const key = `rate-limits:${endpoint}`;
    const data = await this.redis.hgetall(key);
    if (data && data.maxTokens) {
      const limits: EndpointLimits = {
        maxTokens: parseInt(data.maxTokens, 10),
        refillRate: parseInt(data.refillRate, 10),
        refillRateUnit: (data.refillRateUnit as RefillRateUnit) || 'second',
        windowSizeMs: parseInt(data.windowSizeMs, 10),
      };
      this.limitsCache.set(endpoint, limits);
      this.logger.log(`Loaded limits for ${endpoint}: ${JSON.stringify(limits)}`);
    }
  }

  getLimits(endpoint: string): EndpointLimits | undefined {
    return this.limitsCache.get(endpoint);
  }

  async onModuleDestroy() {
    await this.subscriber?.quit();
    await this.redis?.quit();
  }
}
