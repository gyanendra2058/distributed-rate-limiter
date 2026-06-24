import { Injectable, OnModuleInit } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  private hitsCounter: client.Counter;
  private rejectionsCounter: client.Counter;
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
  }

  recordHit(endpoint: string) {
    this.hitsCounter.inc({ endpoint });
  }

  recordRejection(endpoint: string) {
    this.rejectionsCounter.inc({ endpoint });
  }

  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  getContentType(): string {
    return this.registry.contentType;
  }
}
