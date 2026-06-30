import { applyDecorators } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiErrorDto } from '../filters/api-error.dto';

function apiErrorResponse(status: number, description: string) {
  return ApiResponse({
    status,
    description,
    schema: { $ref: getSchemaPath(ApiErrorDto) },
  });
}

/**
 * Documents the standard `ApiErrorDto` contract on business API controllers.
 * Operational routes (health/metrics) intentionally omit this decorator.
 */
export function ApiErrorResponses() {
  return applyDecorators(
    ApiExtraModels(ApiErrorDto),
    apiErrorResponse(400, 'Bad request or validation failure'),
    apiErrorResponse(401, 'Missing or invalid authentication'),
    apiErrorResponse(403, 'Authenticated but not permitted'),
    apiErrorResponse(404, 'Resource not found'),
    apiErrorResponse(409, 'Conflict with current state'),
    apiErrorResponse(429, 'Rate limit exceeded'),
    apiErrorResponse(500, 'Unexpected server error'),
    apiErrorResponse(503, 'Dependency unavailable'),
  );
}
