import * as Sentry from '@sentry/nestjs';
import {
  captureSentryException,
  initSentry,
  isSentryEnabled,
} from './sentry.util';

jest.mock('@sentry/nestjs', () => ({
  init: jest.fn(),
  setTag: jest.fn(),
  withScope: jest.fn(
    (
      callback: (scope: {
        setTag: jest.Mock;
        setUser: jest.Mock;
        setContext: jest.Mock;
      }) => void,
    ) =>
      callback({
        setTag: jest.fn(),
        setUser: jest.fn(),
        setContext: jest.fn(),
      }),
  ),
  captureException: jest.fn(),
}));

describe('sentry.util', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SENTRY_DSN;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('isSentryEnabled returns false without DSN', () => {
    expect(isSentryEnabled()).toBe(false);
  });

  it('initSentry skips initialization without DSN', () => {
    expect(initSentry('api')).toBe(false);
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it('initSentry configures Sentry when DSN is set', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    process.env.SENTRY_ENVIRONMENT = 'staging';
    process.env.SENTRY_RELEASE = 'abc123';
    process.env.SENTRY_TRACES_SAMPLE_RATE = '0.25';

    expect(initSentry('worker')).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://example@sentry.io/1',
        environment: 'staging',
        release: 'abc123',
        tracesSampleRate: 0.25,
      }),
    );
    expect(Sentry.setTag).toHaveBeenCalledWith('service', 'worker');
  });

  it('captureSentryException no-ops without DSN', () => {
    captureSentryException(new Error('boom'), { path: '/health' });
    expect(Sentry.withScope).not.toHaveBeenCalled();
  });

  it('captureSentryException sends request context when enabled', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    const error = new Error('worker failed');

    captureSentryException(error, {
      queue: 'mail',
      jobName: 'send',
      jobId: '42',
    });

    expect(Sentry.withScope).toHaveBeenCalled();
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });
});
