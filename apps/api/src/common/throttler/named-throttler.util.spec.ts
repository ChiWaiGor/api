import { ExecutionContext } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  isNamedThrottlerOptedIn,
  skipUnlessNamedThrottlerOptedIn,
} from './named-throttler.util';

describe('named-throttler.util', () => {
  const createContext = (
    handler: object,
    classRef: object = class {},
  ): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => classRef,
    }) as ExecutionContext;

  describe('isNamedThrottlerOptedIn', () => {
    it('is false when neither handler nor class has @Throttle metadata', () => {
      const ctx = createContext(function bareHandler() {});
      expect(isNamedThrottlerOptedIn(ctx, 'auth')).toBe(false);
      expect(isNamedThrottlerOptedIn(ctx, 'auth-refresh')).toBe(false);
    });

    it('detects empty @Throttle({ auth: {} }) on the handler', () => {
      class Demo {
        @Throttle({ auth: {} })
        login() {}
      }

      const ctx = createContext(Demo.prototype.login, Demo);
      expect(isNamedThrottlerOptedIn(ctx, 'auth')).toBe(true);
      expect(isNamedThrottlerOptedIn(ctx, 'auth-refresh')).toBe(false);
    });

    it('detects @Throttle on the class', () => {
      @Throttle({ 'auth-refresh': {} })
      class RefreshOnly {}

      const ctx = createContext(function handler() {}, RefreshOnly);
      expect(isNamedThrottlerOptedIn(ctx, 'auth-refresh')).toBe(true);
      expect(isNamedThrottlerOptedIn(ctx, 'auth')).toBe(false);
    });
  });

  describe('skipUnlessNamedThrottlerOptedIn', () => {
    it('skips when the route did not opt in', () => {
      const skipIf = skipUnlessNamedThrottlerOptedIn('auth');
      expect(skipIf(createContext(function bare() {}))).toBe(true);
    });

    it('does not skip when the route opted in', () => {
      class Demo {
        @Throttle({ auth: {} })
        login() {}
      }

      const skipIf = skipUnlessNamedThrottlerOptedIn('auth');
      expect(skipIf(createContext(Demo.prototype.login, Demo))).toBe(false);
    });
  });
});
