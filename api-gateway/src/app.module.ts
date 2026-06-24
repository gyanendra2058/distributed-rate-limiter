import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { RateLimiterModule } from './rate-limiter/rate-limiter.module';
import { MetricsModule } from './metrics/metrics.module';
import { GatewayRateLimitMiddleware } from './gateway/gateway.middleware';
import { ProxyMiddleware } from './proxy/proxy.middleware';

@Module({
  imports: [ConfigModule, RateLimiterModule, MetricsModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(GatewayRateLimitMiddleware, ProxyMiddleware)
      .forRoutes('/api');
  }
}
