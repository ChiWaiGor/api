import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/require-permissions.decorator';
import { PERMISSIONS } from '../rbac/permissions.constants';
import { RbacService } from '../rbac/rbac.service';
import {
  CreateUserBodyDto,
  ListUsersQueryDto,
  PaginatedUsersResponseDto,
  UpdateUserBodyDto,
  UserParamsDto,
  UserResponseDto,
} from './user.schema';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rbac: RbacService,
  ) {}

  @RequirePermissions([PERMISSIONS.USERS_READ])
  @Get()
  findAll(
    @Query() query: ListUsersQueryDto,
  ): Promise<PaginatedUsersResponseDto> {
    return this.usersService.findAll(query);
  }

  @Get(':id')
  async findOne(
    @Param() params: UserParamsDto,
    @CurrentUser() user: { sub: string },
  ): Promise<UserResponseDto> {
    const permissions = await this.rbac.getUserPermissions(user.sub);
    return this.usersService.findOne(params.id, user.sub, permissions);
  }

  @RequirePermissions([PERMISSIONS.USERS_WRITE])
  @ApiBadRequestResponse({
    description: 'One or more provided roleNames do not exist.',
  })
  @Post()
  create(@Body() body: CreateUserBodyDto): Promise<UserResponseDto> {
    return this.usersService.create(body);
  }

  @Patch(':id')
  async update(
    @Param() params: UserParamsDto,
    @Body() body: UpdateUserBodyDto,
    @CurrentUser() user: { sub: string },
  ): Promise<UserResponseDto> {
    const permissions = await this.rbac.getUserPermissions(user.sub);
    return this.usersService.update(params.id, body, user.sub, permissions);
  }

  @RequirePermissions([PERMISSIONS.USERS_DELETE])
  @Delete(':id')
  remove(@Param() params: UserParamsDto): Promise<{ success: boolean }> {
    return this.usersService.remove(params.id);
  }
}
