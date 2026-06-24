import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { RateLimitConfigEntity } from './rate-limit-config.entity';

export type RefillRateUnit = 'second' | 'minute' | 'hour';

export interface RateLimitConfig {
  maxTokens: number;
  refillRate: number;
  refillRateUnit: RefillRateUnit;
  windowSizeMs: number;
}

@Injectable()
export class ConfigService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConfigService.name);
  private redis: Redis;

  constructor(
    @InjectRepository(RateLimitConfigEntity)
    private readonly configRepo: Repository<RateLimitConfigEntity>,
  ) {}

  async onModuleInit() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });
    await this.seedDefaults();
    await this.warmCache();
  }

  private async seedDefaults() {
    const defaults: Record<string, RateLimitConfig> = {
      order: { maxTokens: 5, refillRate: 1, refillRateUnit: 'second', windowSizeMs: 60000 },
      products: { maxTokens: 20, refillRate: 5, refillRateUnit: 'second', windowSizeMs: 60000 },
      checkout: { maxTokens: 3, refillRate: 1, refillRateUnit: 'second', windowSizeMs: 60000 },
    };

    for (const [endpoint, config] of Object.entries(defaults)) {
      const existing = await this.configRepo.findOneBy({ endpoint });
      if (!existing) {
        const entity = this.configRepo.create({ endpoint, ...config });
        await this.configRepo.save(entity);
        this.logger.log(`Seeded DB defaults for ${endpoint}`);
      }
    }
  }

  private async warmCache() {
    const allConfigs = await this.configRepo.find();
    for (const config of allConfigs) {
      await this.writeToRedisCache(config.endpoint, {
        maxTokens: config.maxTokens,
        refillRate: config.refillRate,
        refillRateUnit: config.refillRateUnit || 'second',
        windowSizeMs: config.windowSizeMs,
      });
    }
    this.logger.log(`Warmed Redis cache with ${allConfigs.length} configs`);
  }

  private async writeToRedisCache(endpoint: string, config: RateLimitConfig) {
    const key = `rate-limits:${endpoint}`;
    await this.redis.hmset(key, {
      maxTokens: config.maxTokens.toString(),
      refillRate: config.refillRate.toString(),
      refillRateUnit: config.refillRateUnit,
      windowSizeMs: config.windowSizeMs.toString(),
    });
  }

  async getLimits(endpoint: string): Promise<RateLimitConfig | null> {
    const key = `rate-limits:${endpoint}`;
    const cached = await this.redis.hgetall(key);
    if (cached && cached.maxTokens) {
      return {
        maxTokens: parseInt(cached.maxTokens, 10),
        refillRate: parseInt(cached.refillRate, 10),
        refillRateUnit: (cached.refillRateUnit as RefillRateUnit) || 'second',
        windowSizeMs: parseInt(cached.windowSizeMs, 10),
      };
    }

    const entity = await this.configRepo.findOneBy({ endpoint });
    if (!entity) return null;

    const config: RateLimitConfig = {
      maxTokens: entity.maxTokens,
      refillRate: entity.refillRate,
      refillRateUnit: entity.refillRateUnit || 'second',
      windowSizeMs: entity.windowSizeMs,
    };

    await this.writeToRedisCache(endpoint, config);
    this.logger.log(`Cache miss for ${endpoint}, populated from DB`);

    return config;
  }

  async getAllLimits(): Promise<Record<string, RateLimitConfig>> {
    const allConfigs = await this.configRepo.find();
    const result: Record<string, RateLimitConfig> = {};
    for (const entity of allConfigs) {
      result[entity.endpoint] = {
        maxTokens: entity.maxTokens,
        refillRate: entity.refillRate,
        refillRateUnit: entity.refillRateUnit || 'second',
        windowSizeMs: entity.windowSizeMs,
      };
    }
    return result;
  }

  async updateLimits(
    endpoint: string,
    config: Partial<RateLimitConfig>,
  ): Promise<RateLimitConfig> {
    let entity = await this.configRepo.findOneBy({ endpoint });

    if (!entity) {
      entity = this.configRepo.create({
        endpoint,
        maxTokens: config.maxTokens ?? 10,
        refillRate: config.refillRate ?? 5,
        refillRateUnit: config.refillRateUnit ?? 'second',
        windowSizeMs: config.windowSizeMs ?? 60000,
      });
    } else {
      if (config.maxTokens !== undefined) entity.maxTokens = config.maxTokens;
      if (config.refillRate !== undefined) entity.refillRate = config.refillRate;
      if (config.refillRateUnit !== undefined) entity.refillRateUnit = config.refillRateUnit;
      if (config.windowSizeMs !== undefined)
        entity.windowSizeMs = config.windowSizeMs;
    }

    // Write to DB first — if this fails, cache and pub/sub remain consistent
    await this.configRepo.save(entity);

    const updated: RateLimitConfig = {
      maxTokens: entity.maxTokens,
      refillRate: entity.refillRate,
      refillRateUnit: entity.refillRateUnit || 'second',
      windowSizeMs: entity.windowSizeMs,
    };

    await this.writeToRedisCache(endpoint, updated);

    await this.redis.publish(
      'rate-limit-config',
      JSON.stringify({ endpoint, ...updated }),
    );

    this.logger.log(
      `Updated limits for ${endpoint}: ${JSON.stringify(updated)}`,
    );
    return updated;
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
