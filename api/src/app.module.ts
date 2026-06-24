import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { ProductsModule } from './products/products.module';
import { CheckoutModule } from './checkout/checkout.module';

@Module({
  imports: [OrdersModule, ProductsModule, CheckoutModule],
})
export class AppModule {}
