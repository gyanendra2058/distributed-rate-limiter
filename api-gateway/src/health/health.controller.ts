import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { createRedisClient } from '../redis/redis.factory';
import Redis from 'ioredis';

@Controller('health')
export class HealthController {
  private redis: Redis;

  constructor() {
    this.redis = createRedisClient();
  }

  @Get()
  async check(@Res() res: Response) {
    let redisStatus = 'ok';
    try {
      await this.redis.ping();
    } catch {
      redisStatus = 'unreachable';
    }

    const status = redisStatus === 'ok' ? 'ok' : 'degraded';
    const statusCode = status === 'ok' ? 200 : 503;

    res.status(statusCode).json({
      status,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    });
  }
}
