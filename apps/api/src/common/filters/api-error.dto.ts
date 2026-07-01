import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { API_ERROR_CODES, type ApiErrorCode } from './api-error.util';

/** OpenAPI schema for a single field-level validation/detail entry. */
export class ApiErrorDetailDto {
  @ApiPropertyOptional({
    description: 'Dot-separated path to the invalid field, when applicable.',
    example: 'email',
  })
  path?: string;

  @ApiPropertyOptional({
    description: 'Machine-readable detail code (e.g. Zod issue code).',
    example: 'invalid_string',
  })
  code?: string;

  @ApiProperty({
    description: 'Human-readable detail message.',
    example: 'Invalid email',
  })
  message!: string;
}

/**
 * Standard API error body returned by global exception filters for versioned
 * business routes. Operational endpoints (/health, /metrics) bypass this shape.
 */
export class ApiErrorDto {
  @ApiProperty({
    description: 'HTTP status code.',
    example: 400,
  })
  statusCode!: number;

  @ApiProperty({
    description: 'Stable machine-readable error code for client branching.',
    enum: Object.values(API_ERROR_CODES),
    example: API_ERROR_CODES.VALIDATION_FAILED,
  })
  code!: ApiErrorCode;

  @ApiProperty({
    description: 'Human-readable error summary.',
    example: 'Validation failed',
  })
  message!: string;

  @ApiPropertyOptional({
    description: 'Field-level validation or contextual error details.',
    type: [ApiErrorDetailDto],
  })
  details?: ApiErrorDetailDto[];

  @ApiPropertyOptional({
    description: 'Request correlation id when provided or generated.',
    example: 'req-abc123',
  })
  requestId?: string;

  @ApiProperty({
    description: 'ISO-8601 timestamp when the error was produced.',
    example: '2026-06-29T12:00:00.000Z',
  })
  timestamp!: string;

  @ApiProperty({
    description: 'Request path that produced the error.',
    example: '/api/v1/auth/login',
  })
  path!: string;
}
