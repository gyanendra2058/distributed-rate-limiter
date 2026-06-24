import { Controller, Post, Body } from '@nestjs/common';

@Controller('api')
export class CheckoutController {
  @Post('checkout')
  checkout(@Body() body: any) {
    return {
      transactionId: `TXN-${Date.now()}`,
      status: 'completed',
      total: body?.total || 0,
      timestamp: new Date().toISOString(),
    };
  }
}
