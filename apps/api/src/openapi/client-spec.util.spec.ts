import type { OpenAPIObject } from '@nestjs/swagger';
import {
  CLIENT_SPEC_SERVER_URL,
  isOperationalOpenApiPath,
  stripApiV1PathPrefix,
  toClientOpenApiSpec,
} from './client-spec.util';

describe('client-spec.util', () => {
  describe('isOperationalOpenApiPath', () => {
    it.each(['/health', '/health/ready', '/metrics'])(
      'returns true for %s',
      (path) => {
        expect(isOperationalOpenApiPath(path)).toBe(true);
      },
    );

    it('returns false for business routes', () => {
      expect(isOperationalOpenApiPath('/api/v1/auth/login')).toBe(false);
    });
  });

  describe('stripApiV1PathPrefix', () => {
    it('strips the versioned prefix', () => {
      expect(stripApiV1PathPrefix('/api/v1/auth/login')).toBe('/auth/login');
    });

    it('maps the bare prefix to /', () => {
      expect(stripApiV1PathPrefix('/api/v1')).toBe('/');
    });

    it('returns null for paths outside the prefix', () => {
      expect(stripApiV1PathPrefix('/health')).toBeNull();
    });
  });

  describe('toClientOpenApiSpec', () => {
    const baseDocument: OpenAPIObject = {
      openapi: '3.0.0',
      info: { title: 'API', version: '1.0' },
      paths: {
        '/api/v1/auth/login': { post: {} },
        '/health': { get: {} },
        '/metrics': { get: {} },
        '/docs': { get: {} },
      },
    };

    it('rewrites paths, sets servers, and drops operational routes', () => {
      const result = toClientOpenApiSpec(baseDocument);

      expect(result.servers).toEqual([{ url: CLIENT_SPEC_SERVER_URL }]);
      expect(result.paths).toEqual({
        '/auth/login': { post: {} },
      });
    });

    it('handles documents with no paths', () => {
      const result = toClientOpenApiSpec({
        ...baseDocument,
        paths: undefined,
      });

      expect(result.paths).toEqual({});
    });
  });
});
