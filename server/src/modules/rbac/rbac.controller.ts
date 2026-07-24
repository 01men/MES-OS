import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsArray, IsISO8601, IsInt, IsString } from 'class-validator';
import {
  CurrentUser,
  CurrentUserPayload,
} from '../auth/current-user.decorator';
import { RequirePerm } from './require-perm.decorator';
import { RbacService } from './rbac.service';

class AssignUserRolesDto {
  @IsArray()
  roles: (number | string)[];
}

class CreateTempGrantDto {
  @Type(() => Number)
  @IsInt()
  userId: number;

  @IsString()
  permissionCode: string;

  @IsISO8601()
  expiresAt: string;
}

class AssignUserWarehousesDto {
  @IsArray()
  @IsString({ each: true })
  warehouseCodes: string[];
}

@Controller('rbac')
export class RbacController {
  constructor(private readonly service: RbacService) {}

  @Get('users')
  @RequirePerm('rbac.read')
  users() {
    return this.service.users();
  }

  @Get('roles')
  @RequirePerm('rbac.read')
  roles() {
    return this.service.roles();
  }

  @Get('permissions')
  @RequirePerm('rbac.read')
  permissions() {
    return this.service.permissions();
  }

  @Get('temp-grants')
  @RequirePerm('rbac.read')
  tempGrants() {
    return this.service.tempGrants();
  }

  @Post('users/:userId/roles')
  @RequirePerm('rbac.write')
  assignUserRoles(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: AssignUserRolesDto,
    @CurrentUser() operator: CurrentUserPayload,
  ) {
    return this.service.assignUserRoles(userId, body.roles, operator);
  }

  @Post('users/:userId/warehouses')
  @RequirePerm('rbac.write')
  assignUserWarehouses(
    @Param('userId', ParseIntPipe) userId: number,
    @Body() body: AssignUserWarehousesDto,
    @CurrentUser() operator: CurrentUserPayload,
  ) {
    return this.service.assignUserWarehouses(
      userId,
      body.warehouseCodes,
      operator,
    );
  }

  @Post('temp-grants')
  @RequirePerm('rbac.write')
  createTempGrant(
    @Body() body: CreateTempGrantDto,
    @CurrentUser() operator: CurrentUserPayload,
  ) {
    return this.service.createTempGrant(body, operator);
  }

  @Delete('temp-grants/:grantId')
  @RequirePerm('rbac.write')
  revokeTempGrant(
    @Param('grantId', ParseIntPipe) grantId: number,
    @CurrentUser() operator: CurrentUserPayload,
  ) {
    return this.service.revokeTempGrant(grantId, operator);
  }

  @Post('users/:userId/dingtalk/unbind')
  @RequirePerm('rbac.write')
  unbindDingTalk(
    @Param('userId', ParseIntPipe) userId: number,
    @CurrentUser() operator: CurrentUserPayload,
  ) {
    return this.service.unbindDingTalkUser(userId, operator);
  }
}
