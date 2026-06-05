import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { PERMISSIONS } from './permissions.constants';
import type { RbacAuditContext } from './rbac-audit.types';
import {
  AssignRoleBodyDto,
  AttachPermissionBodyDto,
  CreateRoleBodyDto,
  RoleParamsDto,
  UpdateRoleBodyDto,
} from './rbac.schema';
import { RbacService } from './rbac.service';

@ApiTags('rbac')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class RbacController {
  constructor(private readonly rbacService: RbacService) {}

  @RequirePermissions([PERMISSIONS.PERMISSIONS_READ])
  @Get('permissions')
  listPermissions() {
    return this.rbacService.listPermissions();
  }

  @RequirePermissions([PERMISSIONS.ROLES_READ])
  @Get('roles')
  listRoles() {
    return this.rbacService.listRoles().then((roles) =>
      roles.map((role) => ({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        permissions: role.permissions.map((rp) => rp.permission.action),
      })),
    );
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Post('roles')
  createRole(
    @Body() body: CreateRoleBodyDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.createRole(body, this.auditContext(user, req));
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Patch('roles/:id')
  updateRole(
    @Param() params: RoleParamsDto,
    @Body() body: UpdateRoleBodyDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.updateRole(
      params.id,
      body,
      this.auditContext(user, req),
    );
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Delete('roles/:id')
  deleteRole(
    @Param() params: RoleParamsDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.deleteRole(params.id, this.auditContext(user, req));
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Post('roles/assign')
  assignRole(
    @Body() body: AssignRoleBodyDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.assignRoleToUser(
      body,
      this.auditContext(user, req),
    );
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Post('roles/unassign')
  unassignRole(
    @Body() body: AssignRoleBodyDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.unassignRoleFromUser(
      body,
      this.auditContext(user, req),
    );
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Post('roles/permissions/attach')
  attachPermission(
    @Body() body: AttachPermissionBodyDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.attachPermissionToRole(
      body,
      this.auditContext(user, req),
    );
  }

  @RequirePermissions([PERMISSIONS.ROLES_MANAGE])
  @Post('roles/permissions/detach')
  detachPermission(
    @Body() body: AttachPermissionBodyDto,
    @CurrentUser() user: JwtPayload,
    @Req() req: Request,
  ) {
    return this.rbacService.detachPermissionFromRole(
      body,
      this.auditContext(user, req),
    );
  }

  private auditContext(user: JwtPayload, req: Request): RbacAuditContext {
    return {
      actorId: user.sub,
      actorEmail: user.email,
      requestId: (req.headers['x-request-id'] as string) ?? undefined,
      ipAddress: req.ip,
    };
  }
}
