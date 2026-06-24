import { Controller, Get } from '@nestjs/common';

@Controller('api')
export class ProductsController {
  @Get('products')
  getProducts() {
    return [
      { id: 1, name: 'Laptop', price: 999.99 },
      { id: 2, name: 'Phone', price: 699.99 },
      { id: 3, name: 'Headphones', price: 149.99 },
      { id: 4, name: 'Keyboard', price: 79.99 },
    ];
  }
}
