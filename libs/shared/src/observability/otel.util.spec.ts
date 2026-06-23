import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  initOpenTelemetry,
  isMetricsEnabled,
  isOtelTracesEnabled,
  shutdownOpenTelemetry,
} from './otel.util';

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

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OTEL_TRACES_ENABLED;
    delete process.env.METRICS_ENABLED;
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('reports disabled when env flags are unset', () => {
    expect(isOtelTracesEnabled()).toBe(false);
    expect(isMetricsEnabled()).toBe(false);
    expect(initOpenTelemetry('api')).toBe(false);
    expect(NodeSDK).not.toHaveBeenCalled();
  });

  it('starts NodeSDK when metrics are enabled', () => {
    process.env.METRICS_ENABLED = 'true';
    process.env.METRICS_PORT = '9464';

    expect(initOpenTelemetry('worker')).toBe(true);
    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'worker',
        metricReaders: expect.any(Array),
      }),
    );
  });

  it('starts NodeSDK with OTLP exporter when tracing is enabled', () => {
    process.env.OTEL_TRACES_ENABLED = 'true';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://collector:4318';

    expect(initOpenTelemetry('api')).toBe(true);
    expect(NodeSDK).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceName: 'api',
        traceExporter: expect.any(Object),
        sampler: expect.any(Object),
      }),
    );
  });

  it('shutdownOpenTelemetry is safe when SDK was not started', async () => {
    await expect(shutdownOpenTelemetry()).resolves.toBeUndefined();
  });
});
