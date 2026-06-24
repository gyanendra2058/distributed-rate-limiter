import { Module, Global } from '@nestjs/common';
import { ConfigSubscriberService } from './config-subscriber.service';

@Global()
@Module({
  providers: [ConfigSubscriberService],
  exports: [ConfigSubscriberService],
})
export class ConfigModule {}
