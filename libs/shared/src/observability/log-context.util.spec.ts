import { context, trace } from '@opentelemetry/api';
import { getOtelLogFields } from './log-context.util';
import { isObservabilityEnabled } from './otel.util';

jest.mock('./otel.util', () => ({
  isObservabilityEnabled: jest.fn(),
}));

describe('getOtelLogFields', () => {
  const isObservabilityEnabledMock =
    isObservabilityEnabled as jest.MockedFunction<
      typeof isObservabilityEnabled
    >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty object when observability is disabled', () => {
    isObservabilityEnabledMock.mockReturnValue(false);

    expect(getOtelLogFields()).toEqual({});
  });

  it('returns empty object when no active span exists', () => {
    isObservabilityEnabledMock.mockReturnValue(true);
    jest.spyOn(context, 'active').mockReturnValue({} as never);
    jest.spyOn(trace, 'getSpan').mockReturnValue(undefined);

    expect(getOtelLogFields()).toEqual({});
  });

  it('returns trace and span ids from the active span', () => {
    isObservabilityEnabledMock.mockReturnValue(true);
    jest.spyOn(context, 'active').mockReturnValue({} as never);
    jest.spyOn(trace, 'getSpan').mockReturnValue({
      spanContext: () => ({
        traceId: 'trace-123',
        spanId: 'span-456',
      }),
    } as never);

    expect(getOtelLogFields()).toEqual({
      trace_id: 'trace-123',
      span_id: 'span-456',
    });
  });
});
