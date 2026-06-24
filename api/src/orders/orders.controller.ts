import { Controller, Post, Body } from '@nestjs/common';

@Controller('api')
export class OrdersController {
  @Post('order')
  createOrder(@Body() body: any) {
    return {
      orderId: `ORD-${Date.now()}`,
      status: 'created',
      items: body?.items || [],
      timestamp: new Date().toISOString(),
    };
  }
}
