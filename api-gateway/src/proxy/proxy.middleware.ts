import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';

@Injectable()
export class ProxyMiddleware implements NestMiddleware {
  private proxy = createProxyMiddleware({
    target: process.env.API_SERVICE_URL || 'http://api:3000',
    changeOrigin: true,
    on: {
      proxyRes: (proxyRes, req: Request, res: Response) => {
        const headers = (req as any).rateLimitHeaders;
        if (headers) {
          for (const [key, value] of Object.entries(headers)) {
            proxyRes.headers[key.toLowerCase()] = String(value);
          }
        }
      },
    },
  });

  use(req: Request, res: Response, next: NextFunction) {
    req.url = req.originalUrl;
    this.proxy(req, res, next);
  }
}
