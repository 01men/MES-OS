import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { IsArray } from 'class-validator';
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
}
