import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RuleConfig } from './rule-config.entity';
import { RuleConfigService } from './rule-config.service';
import { RuleConfigController } from './rule-config.controller';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([RuleConfig])],
  controllers: [RuleConfigController],
  providers: [RuleConfigService],
  exports: [RuleConfigService],
})
export class ConfigModule {}
