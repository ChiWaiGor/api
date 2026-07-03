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

  it('captureSentryException attaches job context with jobId when enabled', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    const error = new Error('worker failed');
    const setTag = jest.fn();
    const setContext = jest.fn();
    (Sentry.withScope as jest.Mock).mockImplementation((callback) =>
      callback({ setTag, setUser: jest.fn(), setContext }),
    );

    captureSentryException(error, {
      queue: 'mail',
      jobName: 'send',
      jobId: '42',
    });

    expect(setTag).toHaveBeenCalledWith('queue', 'mail');
    expect(setTag).toHaveBeenCalledWith('jobName', 'send');
    expect(setTag).toHaveBeenCalledWith('jobId', '42');
    expect(setContext).toHaveBeenCalledWith('job', {
      queue: 'mail',
      jobName: 'send',
      jobId: '42',
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('isSentryEnabled returns true when DSN is set', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    expect(isSentryEnabled()).toBe(true);
  });

  it('initSentry uses NODE_ENV when SENTRY_ENVIRONMENT is unset', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    process.env.NODE_ENV = 'test';

    expect(initSentry('api')).toBe(true);
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'test',
        release: undefined,
        tracesSampleRate: 0,
      }),
    );
  });

  it('initSentry treats invalid traces sample rates as zero', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    process.env.SENTRY_TRACES_SAMPLE_RATE = 'not-a-number';

    initSentry('api');

    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ tracesSampleRate: 0 }),
    );
  });

  it('initSentry scrubs sensitive request data in beforeSend', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';

    initSentry('api');
    const beforeSend = (Sentry.init as jest.Mock).mock.calls[0][0]
      .beforeSend as (event: {
      request?: {
        headers?: Record<string, string>;
        data?: Record<string, unknown>;
      };
    }) => typeof event;

    const scrubbed = beforeSend({
      request: {
        headers: {
          authorization: 'secret',
          'content-type': 'application/json',
        },
        data: { password: 'hidden', email: 'user@example.com' },
      },
    });

    expect(scrubbed.request?.headers).toEqual({
      authorization: '[Filtered]',
      'content-type': 'application/json',
    });
    expect(scrubbed.request?.data).toEqual({
      password: '[Filtered]',
      email: 'user@example.com',
    });
  });

  it('initSentry beforeSend scrubs nested arrays and preserves nullish values', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';

    initSentry('api');
    const beforeSend = (Sentry.init as jest.Mock).mock.calls[0][0]
      .beforeSend as (event: {
      request?: {
        data?: unknown;
      };
    }) => typeof event;

    const scrubbed = beforeSend({
      request: {
        data: [{ password: 'hidden' }, null, 'plain'],
      },
    });

    expect(scrubbed.request?.data).toEqual([
      { password: '[Filtered]' },
      null,
      'plain',
    ]);
  });

  it('captureSentryException attaches HTTP request context', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    const setTag = jest.fn();
    const setUser = jest.fn();
    (Sentry.withScope as jest.Mock).mockImplementation((callback) =>
      callback({ setTag, setUser, setContext: jest.fn() }),
    );

    captureSentryException(new Error('request failed'), {
      requestId: 'req-1',
      path: '/api/v1/users',
      method: 'GET',
      userId: 'user-1',
    });

    expect(setTag).toHaveBeenCalledWith('requestId', 'req-1');
    expect(setTag).toHaveBeenCalledWith('path', '/api/v1/users');
    expect(setTag).toHaveBeenCalledWith('method', 'GET');
    expect(setUser).toHaveBeenCalledWith({ id: 'user-1' });
  });

  it('captureSentryException attaches job context without jobId', () => {
    process.env.SENTRY_DSN = 'https://example@sentry.io/1';
    const setTag = jest.fn();
    (Sentry.withScope as jest.Mock).mockImplementation((callback) =>
      callback({ setTag, setUser: jest.fn(), setContext: jest.fn() }),
    );

    captureSentryException(new Error('job failed'), {
      queue: 'mail',
      jobName: 'send',
    });

    expect(setTag).toHaveBeenCalledWith('queue', 'mail');
    expect(setTag).toHaveBeenCalledWith('jobName', 'send');
    expect(setTag).not.toHaveBeenCalledWith('jobId', expect.anything());
  });
});
