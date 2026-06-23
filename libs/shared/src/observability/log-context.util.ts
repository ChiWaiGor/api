import { context, trace } from '@opentelemetry/api';
import { isObservabilityEnabled } from './otel.util';

export interface OtelLogFields {
  trace_id?: string;
  span_id?: string;
}

/** Active span identifiers for Pino log correlation. */
export function getOtelLogFields(): OtelLogFields {
  if (!isObservabilityEnabled()) {
    return {};
  }

  const span = trace.getSpan(context.active());
  const spanContext = span?.spanContext();
  if (!spanContext?.traceId) {
    return {};
  }

  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}
