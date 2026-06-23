import {
  normalizeHttpRoute,
  recordHttpRequest,
  recordLoginAttempt,
  recordRedisCircuitState,
  resetMetricsStateForTests,
} from './metrics.util';
import * as otelUtil from './otel.util';

describe('metrics.util', () => {
  beforeEach(() => {
    resetMetricsStateForTests();
    jest.spyOn(otelUtil, 'isMetricsEnabled').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('normalizes dynamic path segments', () => {
    expect(
      normalizeHttpRoute('/users/550e8400-e29b-41d4-a716-446655440000'),
    ).toBe('/users/:id');
    expect(normalizeHttpRoute('/users/42')).toBe('/users/:id');
    expect(normalizeHttpRoute('/users/:id')).toBe('/users/:id');
  });

  it('no-ops when metrics are disabled', () => {
    expect(() => {
      recordHttpRequest('GET', '/health', 200, 12);
      recordLoginAttempt('success');
      recordRedisCircuitState('open');
    }).not.toThrow();
  });

  it('records metrics when enabled', () => {
    jest.spyOn(otelUtil, 'isMetricsEnabled').mockReturnValue(true);

    expect(() => {
      recordHttpRequest('POST', '/auth/login', 201, 45);
      recordLoginAttempt('invalid_credentials');
      recordRedisCircuitState('closed');
      recordRedisCircuitState('open');
    }).not.toThrow();
  });
});
