import Redis from 'ioredis';

export function createRedisClient(): Redis {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const clusterMode = process.env.REDIS_CLUSTER_MODE === 'true';

  if (clusterMode) {
    return new Redis.Cluster([{ host, port }]) as unknown as Redis;
  }

  return new Redis({ host, port });
}
