import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const port = process.env.PORT || 5000;
  await app.listen(port);
  Logger.log(
    `API Gateway pod ${process.env.HOSTNAME || 'local'} listening on port ${port}`,
    'Bootstrap',
  );
}
bootstrap();
