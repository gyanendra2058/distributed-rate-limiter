import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private hitsCounter: client.Counter;
  private rejectionsCounter: client.Counter;
  private checkDuration: client.Histogram;
  private registry: client.Registry;

  onModuleInit() {
    this.registry = new client.Registry();
    this.registry.setDefaultLabels({
      app: 'api-gateway',
      pod: process.env.HOSTNAME || 'unknown',
    });

    this.hitsCounter = new client.Counter({
      name: 'rate_limit_hits_total',
      help: 'Total number of rate limit checks per endpoint',
      labelNames: ['endpoint'],
      registers: [this.registry],
    });

    this.rejectionsCounter = new client.Counter({
      name: 'rate_limit_rejections_total',
      help: 'Total number of rate limit rejections per endpoint',
      labelNames: ['endpoint'],
      registers: [this.registry],
    });

    this.checkDuration = new client.Histogram({
      name: 'rate_limit_check_duration_seconds',
      help: 'Duration of rate limit check (Redis round-trip)',
      labelNames: ['endpoint'],
      buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
      registers: [this.registry],
    });
  }

  recordHit(endpoint: string) {
    this.hitsCounter.inc({ endpoint });
  }

  recordRejection(endpoint: string) {
    this.rejectionsCounter.inc({ endpoint });
  }

  startTimer(endpoint: string): () => void {
    return this.checkDuration.startTimer({ endpoint });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
