const mockCounterAdd = jest.fn();
const mockHistogramRecord = jest.fn();
const mockUpDownAdd = jest.fn();

jest.mock('./otel.util', () => ({
  isMetricsEnabled: jest.fn(),
}));

jest.mock('@opentelemetry/api', () => ({
  metrics: {
    getMeter: jest.fn(() => ({
      createCounter: jest.fn(() => ({ add: mockCounterAdd })),
      createHistogram: jest.fn(() => ({ record: mockHistogramRecord })),
      createUpDownCounter: jest.fn(() => ({ add: mockUpDownAdd })),
    })),
  },
}));

import { isMetricsEnabled } from './otel.util';
import {
  normalizeHttpRoute,
  recordAccountLockout,
  recordHttpRequest,
  recordLoginAttempt,
  recordMailJob,
  recordPasswordResetRequest,
  recordRedisCircuitState,
  recordRedisOperationError,
  recordRefreshAttempt,
  recordThrottleRejection,
  resetMetricsStateForTests,
} from './metrics.util';

describe('metrics.util', () => {
  const isMetricsEnabledMock = isMetricsEnabled as jest.MockedFunction<
    typeof isMetricsEnabled
  >;

  beforeEach(() => {
    resetMetricsStateForTests();
    mockCounterAdd.mockClear();
    mockHistogramRecord.mockClear();
    mockUpDownAdd.mockClear();
    isMetricsEnabledMock.mockReturnValue(false);
  });

  describe('normalizeHttpRoute', () => {
    it('normalizes UUID, numeric, cuid, and long hex segments', () => {
      expect(
        normalizeHttpRoute('/users/550e8400-e29b-41d4-a716-446655440000'),
      ).toBe('/users/:id');
      expect(normalizeHttpRoute('/users/42')).toBe('/users/:id');
      expect(normalizeHttpRoute('/users/clh1234567890123456789012')).toBe(
        '/users/:id',
      );
      expect(normalizeHttpRoute('/tokens/abcdef0123456789abcdef01')).toBe(
        '/tokens/:id',
      );
      expect(normalizeHttpRoute('/users/:id')).toBe('/users/:id');
    });
  });

  describe('when metrics are disabled', () => {
    it('no-ops for all record helpers', () => {
      expect(() => {
        recordHttpRequest('GET', '/health', 200, 12);
        recordLoginAttempt('success');
        recordRefreshAttempt('invalid');
        recordAccountLockout();
        recordPasswordResetRequest();
        recordThrottleRejection('auth');
        recordRedisOperationError();
        recordRedisCircuitState('open');
        recordMailJob('success', 100);
      }).not.toThrow();

      expect(mockCounterAdd).not.toHaveBeenCalled();
      expect(mockHistogramRecord).not.toHaveBeenCalled();
      expect(mockUpDownAdd).not.toHaveBeenCalled();
    });
  });

  describe('when metrics are enabled', () => {
    beforeEach(() => {
      isMetricsEnabledMock.mockReturnValue(true);
    });

    it('records HTTP requests and throttle rejections for 429', () => {
      recordHttpRequest('post', '/users/42', 429, 50);

      expect(mockCounterAdd).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          method: 'POST',
          route: '/users/:id',
          status: '429',
        }),
      );
      expect(mockHistogramRecord).toHaveBeenCalledWith(
        0.05,
        expect.objectContaining({ status: '429' }),
      );
      expect(mockCounterAdd).toHaveBeenCalledWith(1, {
        throttler: 'default',
      });
    });

    it('records auth and infra counters', () => {
      recordLoginAttempt('locked');
      recordRefreshAttempt('reuse_detected');
      recordAccountLockout();
      recordPasswordResetRequest();
      recordThrottleRejection('auth');
      recordRedisOperationError();

      expect(mockCounterAdd).toHaveBeenCalledWith(1, { result: 'locked' });
      expect(mockCounterAdd).toHaveBeenCalledWith(1, {
        result: 'reuse_detected',
      });
      expect(mockCounterAdd).toHaveBeenCalledWith(1);
      expect(mockCounterAdd).toHaveBeenCalledWith(1, { throttler: 'auth' });
    });

    it('records mail job counters and duration', () => {
      recordMailJob('failure', 250);

      expect(mockCounterAdd).toHaveBeenCalledWith(1, { result: 'failure' });
      expect(mockHistogramRecord).toHaveBeenCalledWith(0.25, {
        result: 'failure',
      });
    });

    it('tracks redis circuit breaker transitions and skips duplicate state', () => {
      recordRedisCircuitState('closed');
      recordRedisCircuitState('closed');
      recordRedisCircuitState('open');
      recordRedisCircuitState('half-open');

      expect(mockUpDownAdd).toHaveBeenCalledWith(0);
      expect(mockUpDownAdd).toHaveBeenCalledWith(1);
      expect(mockUpDownAdd).toHaveBeenCalledWith(-1);
      expect(mockUpDownAdd).toHaveBeenCalledWith(2);
      expect(mockUpDownAdd).toHaveBeenCalledTimes(5);
    });
  });
});
