import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import {
  initOpenTelemetry,
  isMetricsEnabled,
  isObservabilityEnabled,
  isOtelTracesEnabled,
  shutdownOpenTelemetry,
} from './otel.util';

jest.mock('@opentelemetry/sdk-trace-base', () => {
  const actual = jest.requireActual('@opentelemetry/sdk-trace-base');
  return {
    ...actual,
    TraceIdRatioBasedSampler: jest.fn(
      (...args: [number]) => new actual.TraceIdRatioBasedSampler(...args),
    ),
    ParentBasedSampler: jest.fn(
      (...args: [ConstructorParameters<typeof actual.ParentBasedSampler>[0]]) =>
        new actual.ParentBasedSampler(...args),
    ),
  };
});

jest.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('@opentelemetry/auto-instrumentations-node', () => ({
  getNodeAutoInstrumentations: jest.fn(() => []),
}));

jest.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: jest.fn(),
}));

jest.mock('@opentelemetry/exporter-prometheus', () => ({
  PrometheusExporter: jest.fn(),
}));

describe('otel.util', () => {
  const originalEnv = process.env;

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OTEL_TRACES_ENABLED;
    delete process.env.METRICS_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    delete process.env.OTEL_TRACES_SAMPLER_ARG;
    delete process.env.METRICS_PORT;
    delete process.env.OTEL_SERVICE_NAME;
    await shutdownOpenTelemetry();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports disabled when env flags are unset', () => {
    expect(isOtelTracesEnabled()).toBe(false);
    expect(isMetricsEnabled()).toBe(false);
    expect(isObservabilityEnabled()).toBe(false);
    expect(initOpenTelemetry('api')).toBe(false);
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('reports observability enabled when either flag is set', () => {
    process.env.METRICS_ENABLED = 'true';
    expect(isObservabilityEnabled()).toBe(true);
  });

  it('treats "1" as enabled for trace and metrics flags', () => {
    process.env.OTEL_TRACES_ENABLED = '1';
    expect(isOtelTracesEnabled()).toBe(true);

    delete process.env.OTEL_TRACES_ENABLED;
    process.env.METRICS_ENABLED = '1';
    expect(isMetricsEnabled()).toBe(true);
  });

  it('starts NodeSDK when metrics are enabled', () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_PORT = '9464';

    expect(initOpenTelemetry('worker')).toBe(true);
    expect(PrometheusExporter).toHaveBeenCalledWith({
      port: 9464,
      preventServerStart: false,
    });
    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'worker',
        metricReaders: expect.any(Array),
        traceExporter: undefined,
      }),
    );
  });

  it('falls back to default metrics port when METRICS_PORT is invalid', () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_PORT = 'not-a-port';

    initOpenTelemetry('worker');

    expect(PrometheusExporter).toHaveBeenCalledWith({
      port: 9464,
      preventServerStart: false,
    });
  });

  it('starts NodeSDK with OTLP exporter when tracing is enabled', () => {
    process.env.OTEL_TRACES_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318/';

    expect(initOpenTelemetry('api')).toBe(true);
    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'http://collector:4318/v1/traces',
    });
    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'api',
        traceExporter: expect.any(Object),
        sampler: expect.any(Object),
      }),
    );
  });

  it('preserves OTLP endpoint that already includes /v1/traces', () => {
    process.env.OTEL_TRACES_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318/v1/traces';

    initOpenTelemetry('api');

    expect(OTLPTraceExporter).toHaveBeenCalledWith({
      url: 'http://collector:4318/v1/traces',
    });
  });

  it('omits trace exporter when tracing is enabled without an OTLP endpoint', () => {
    process.env.OTEL_TRACES_ENABLED = 'true';

    initOpenTelemetry('api');

    expect(OTLPTraceExporter).not.toHaveBeenCalled();
    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        traceExporter: undefined,
        sampler: expect.any(Object),
      }),
    );
  });

  it('falls back invalid sampler arg to 0.1', () => {
    process.env.OTEL_TRACES_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.OTEL_TRACES_SAMPLER_ARG = '2';

    initOpenTelemetry('api');

    expect(TraceIdRatioBasedSampler).toHaveBeenCalledWith(0.1);
    expect(ParentBasedSampler).toHaveBeenCalled();
  });

  it('uses OTEL_SERVICE_NAME and custom sampler arg when valid', () => {
    process.env.OTEL_TRACES_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';
    process.env.OTEL_SERVICE_NAME = 'custom-api';
    process.env.OTEL_TRACES_SAMPLER_ARG = '0.5';

    initOpenTelemetry('api');

    expect(TraceIdRatioBasedSampler).toHaveBeenCalledWith(0.5);
    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'custom-api',
      }),
    );
  });

  it('replaces the active SDK when init is called twice', async () => {
    process.env.METRICS_ENABLED = 'true';

    initOpenTelemetry('api');
    const firstInstance = (NodeSDK as jest.Mock).mock.results[0].value as {
      shutdown: jest.Mock;
    };

    initOpenTelemetry('worker');
    const secondInstance = (NodeSDK as jest.Mock).mock.results[1].value as {
      shutdown: jest.Mock;
    };

    expect(NodeSDK).toHaveBeenCalledTimes(2);
    expect(firstInstance).not.toBe(secondInstance);

    await shutdownOpenTelemetry();

    expect(secondInstance.shutdown).toHaveBeenCalled();
    expect(firstInstance.shutdown).not.toHaveBeenCalled();
  });

  it('registers signal handlers that shut down the SDK', async () => {
    process.env.METRICS_ENABLED = 'true';

    initOpenTelemetry('api');
    const sdkInstance = (NodeSDK as jest.Mock).mock.results.at(-1)?.value as {
      shutdown: jest.Mock;
    };

    process.emit('SIGTERM');
    await new Promise((resolve) => setImmediate(resolve));

    expect(sdkInstance.shutdown).toHaveBeenCalled();
  });

  it('shutdownOpenTelemetry is safe when SDK was not started', async () => {
    await expect(shutdownOpenTelemetry()).resolves.toBeUndefined();
  });

  it('shuts down an initialized SDK', async () => {
    process.env.METRICS_ENABLED = 'true';

    initOpenTelemetry('api');
    const sdkInstance = (NodeSDK as jest.Mock).mock.results[0].value as {
      shutdown: jest.Mock;
    };

    await shutdownOpenTelemetry();

    expect(sdkInstance.shutdown).toHaveBeenCalled();
    await expect(shutdownOpenTelemetry()).resolves.toBeUndefined();
  });
});
