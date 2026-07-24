import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { MasterdataService } from './masterdata.service';
import { RequirePerm } from '../rbac/require-perm.decorator';

/**
 * 主数据 REST：/api/masterdata/:resource
 * resource ∈ materials | suppliers | customers | warehouses | locations | work-orders | boms
 */
@Controller('masterdata')
export class MasterdataController {
  constructor(private readonly svc: MasterdataService) {}

  @Get(':resource')
  @RequirePerm('masterdata.read')
  list(@Param('resource') resource: string) {
    return this.svc.list(resource);
  }

  @Get(':resource/:code')
  @RequirePerm('masterdata.read')
  get(@Param('resource') resource: string, @Param('code') code: string) {
    return this.svc.get(resource, code);
  }

  @Post(':resource')
  @RequirePerm('masterdata.material.create')
  create(@Param('resource') resource: string, @Body() body: any) {
    return this.svc.create(resource, body);
  }

  @Patch(':resource/:code')
  @RequirePerm('masterdata.material.update')
  update(
    @Param('resource') resource: string,
    @Param('code') code: string,
    @Body() body: any,
  ) {
    return this.svc.update(resource, code, body);
  }

  @Delete(':resource/:code')
  @RequirePerm('masterdata.material.delete')
  remove(@Param('resource') resource: string, @Param('code') code: string) {
    return this.svc.remove(resource, code);
  }
}
