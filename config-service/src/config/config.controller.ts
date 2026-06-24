import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService, RateLimitConfig } from './config.service';

@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get('limits')
  async getAllLimits() {
    return this.configService.getAllLimits();
  }

  @Get('limits/:endpoint')
  async getLimits(@Param('endpoint') endpoint: string) {
    const limits = await this.configService.getLimits(endpoint);
    if (!limits) {
      throw new NotFoundException(`No limits found for endpoint: ${endpoint}`);
    }
    return limits;
  }

  @Put('limits/:endpoint')
  async updateLimits(
    @Param('endpoint') endpoint: string,
    @Body() body: Partial<RateLimitConfig>,
  ) {
    return this.configService.updateLimits(endpoint, body);
  }
}
