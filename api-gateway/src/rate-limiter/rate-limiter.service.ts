import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

@Injectable()
export class RateLimiterService implements OnModuleInit {
  private readonly logger = new Logger(RateLimiterService.name);
  private redis: Redis;
  private tokenBucketScript: string;
  private slidingWindowScript: string;

  onModuleInit() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
    });

    this.tokenBucketScript = fs.readFileSync(
      path.join(__dirname, 'lua', 'token-bucket.lua'),
      'utf-8',
    );
    this.slidingWindowScript = fs.readFileSync(
      path.join(__dirname, 'lua', 'sliding-window.lua'),
      'utf-8',
    );

    this.logger.log('Rate limiter service initialized');
  }

  async checkTokenBucket(
    userId: string,
    endpoint: string,
    maxTokens: number,
    refillRate: number,
  ): Promise<RateLimitResult> {
    const key = `ratelimit:${userId}:${endpoint}`;
    const now = Date.now();

    const result = (await this.redis.eval(
      this.tokenBucketScript,
      1,
      key,
      maxTokens,
      refillRate,
      now,
      1,
    )) as number[];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      retryAfterMs: result[2],
    };
  }

  async checkSlidingWindow(
    userId: string,
    endpoint: string,
    maxRequests: number,
    windowSizeMs: number,
  ): Promise<RateLimitResult> {
    const key = `ratelimit:sw:${userId}:${endpoint}`;
    const now = Date.now();
    const requestId = `${now}:${Math.random().toString(36).slice(2, 10)}`;

    const result = (await this.redis.eval(
      this.slidingWindowScript,
      1,
      key,
      maxRequests,
      windowSizeMs,
      now,
      requestId,
    )) as number[];

    return {
      allowed: result[0] === 1,
      remaining: result[1],
      retryAfterMs: result[2],
    };
  }
}
