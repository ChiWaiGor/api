import { Module } from '@nestjs/common';
import { RbacAuditService } from './rbac-audit.service';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';

@Module({
  controllers: [RbacController],
  providers: [RbacService, RbacAuditService],
  exports: [RbacService],
})
export class RbacModule {}
