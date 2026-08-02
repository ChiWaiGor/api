import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { AuthRefreshThrottle, AuthThrottle } from './auth-throttle.decorators';
import { isNamedThrottlerOptedIn } from './named-throttler.util';

describe('auth-throttle.decorators', () => {
  it('AuthThrottle opts into auth and skips default + auth-refresh', () => {
    class Demo {
      @AuthThrottle()
      login() {}
    }

    const handler = Demo.prototype.login;
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:SKIPauth-refresh', handler)).toBe(
      true,
    );
    expect(
      isNamedThrottlerOptedIn(
        {
          getHandler: () => handler,
          getClass: () => Demo,
        } as never,
        'auth',
      ),
    ).toBe(true);
    expect(
      isNamedThrottlerOptedIn(
        {
          getHandler: () => handler,
          getClass: () => Demo,
        } as never,
        'auth-refresh',
      ),
    ).toBe(false);
  });

  it('AuthRefreshThrottle opts into auth-refresh and skips default + auth', () => {
    class Demo {
      @AuthRefreshThrottle()
      refresh() {}
    }

    const handler = Demo.prototype.refresh;
    expect(Reflect.getMetadata('THROTTLER:SKIPdefault', handler)).toBe(true);
    expect(Reflect.getMetadata('THROTTLER:SKIPauth', handler)).toBe(true);
    expect(
      isNamedThrottlerOptedIn(
        {
          getHandler: () => handler,
          getClass: () => Demo,
        } as never,
        'auth-refresh',
      ),
    ).toBe(true);
    expect(
      isNamedThrottlerOptedIn(
        {
          getHandler: () => handler,
          getClass: () => Demo,
        } as never,
        'auth',
      ),
    ).toBe(false);
  });

  it('matches the composition of SkipThrottle + Throttle', () => {
    class ViaHelpers {
      @AuthThrottle()
      a() {}

      @AuthRefreshThrottle()
      b() {}
    }

    class ViaRaw {
      @SkipThrottle({ default: true, 'auth-refresh': true })
      @Throttle({ auth: {} })
      a() {}

      @SkipThrottle({ default: true, auth: true })
      @Throttle({ 'auth-refresh': {} })
      b() {}
    }

    for (const method of ['a', 'b'] as const) {
      const helperHandler = ViaHelpers.prototype[method];
      const rawHandler = ViaRaw.prototype[method];
      expect(Reflect.getMetadataKeys(helperHandler).sort()).toEqual(
        Reflect.getMetadataKeys(rawHandler).sort(),
      );
      for (const key of Reflect.getMetadataKeys(helperHandler)) {
        expect(Reflect.getMetadata(key, helperHandler)).toEqual(
          Reflect.getMetadata(key, rawHandler),
        );
      }
    }
  });
});
