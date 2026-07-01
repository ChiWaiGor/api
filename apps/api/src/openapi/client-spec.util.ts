import type { OpenAPIObject } from '@nestjs/swagger';

export const CLIENT_SPEC_SERVER_URL = '/api/v1';

const OPERATIONAL_PATH_PREFIXES = ['/health', '/metrics'];

/** Paths excluded from the public client spec (probes, metrics scrape, etc.). */
export function isOperationalOpenApiPath(path: string): boolean {
  return OPERATIONAL_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

/**
 * Strips the versioned API prefix from a Swagger path key.
 * Returns `null` when the path is not under the expected prefix.
 */
export function stripApiV1PathPrefix(
  path: string,
  apiPrefix = CLIENT_SPEC_SERVER_URL,
): string | null {
  if (path === apiPrefix) {
    return '/';
  }
  if (path.startsWith(`${apiPrefix}/`)) {
    return path.slice(apiPrefix.length);
  }
  return null;
}

/**
 * Produces a frontend/SDK-oriented OpenAPI document:
 * - drops operational routes
 * - rewrites path keys to omit `/api/v1` (server URL carries the prefix)
 * - sets `servers` to `[{ url: '/api/v1' }]`
 */
export function toClientOpenApiSpec(
  document: OpenAPIObject,
  apiPrefix = CLIENT_SPEC_SERVER_URL,
): OpenAPIObject {
  const filteredPaths: NonNullable<OpenAPIObject['paths']> = {};

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (isOperationalOpenApiPath(path)) {
      continue;
    }

    const stripped = stripApiV1PathPrefix(path, apiPrefix);
    if (stripped === null) {
      continue;
    }

    filteredPaths[stripped] = pathItem;
  }

  return {
    ...document,
    servers: [{ url: apiPrefix }],
    paths: filteredPaths,
  };
}
