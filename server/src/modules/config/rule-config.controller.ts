import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { RuleConfigService } from './rule-config.service';
import { RequirePerm } from '../rbac/require-perm.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Controller('config')
export class RuleConfigController {
  constructor(private readonly svc: RuleConfigService) {}

  @Get('rules')
  @RequirePerm('config.read')
  list() {
    return this.svc.listCurrent();
  }

  @Get('rules/:key')
  @RequirePerm('config.read')
  get(@Param('key') key: string) {
    return this.svc.get(key);
  }

  @Get('rules/:key/history')
  @RequirePerm('config.read')
  history(@Param('key') key: string) {
    return this.svc.history(key);
  }

  @Get('rules/:key/versions')
  @RequirePerm('config.read')
  versions(@Param('key') key: string) {
    return this.svc.history(key);
  }

  @Post('rules')
  @RequirePerm('config.write')
  set(@Body() body: { key: string; value: string }, @CurrentUser('username') operator: string) {
    return this.svc.set(body.key, body.value, operator);
  }
}
