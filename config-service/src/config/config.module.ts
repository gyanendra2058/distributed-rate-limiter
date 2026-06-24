import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { RateLimitConfigEntity } from './rate-limit-config.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RateLimitConfigEntity])],
  controllers: [ConfigController],
  providers: [ConfigService],
})
export class ConfigModule {}
