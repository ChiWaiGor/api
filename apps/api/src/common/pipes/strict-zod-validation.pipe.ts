import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  Type,
} from '@nestjs/common';
import {
  createZodValidationPipe,
  ZodSchemaDeclarationException,
  type ZodDto,
} from 'nestjs-zod';

function isNestJsZodDto(metatype: unknown): metatype is ZodDto {
  return (
    typeof metatype === 'function' &&
    'isZodDto' in metatype &&
    (metatype as { isZodDto?: boolean }).isZodDto === true
  );
}

/** Request inputs that must declare a nestjs-zod DTO when strict mode is on. */
const STRICT_PARAM_TYPES = new Set<ArgumentMetadata['type']>([
  'body',
  'query',
  'param',
]);

const BaseZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: false,
});

/**
 * Global validation pipe with strictSchemaDeclaration enabled for body, query,
 * and route params only. Custom decorators (@CurrentUser, @Req, etc.) are
 * excluded — nestjs-zod's built-in strict mode would 500 on those.
 */
@Injectable()
export class StrictZodValidationPipe
  extends BaseZodValidationPipe
  implements PipeTransform
{
  constructor(schemaOrDto?: ZodDto) {
    super(schemaOrDto);
  }

  override transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!STRICT_PARAM_TYPES.has(metadata.type)) {
      return value;
    }

    const metatype = metadata.metatype as Type<unknown> | undefined;
    if (!metatype || !isNestJsZodDto(metatype)) {
      throw new ZodSchemaDeclarationException();
    }

    return super.transform(value, metadata) as unknown;
  }
}
