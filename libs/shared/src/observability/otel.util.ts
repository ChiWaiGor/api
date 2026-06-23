import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';

export type OtelServiceName = 'api' | 'worker';

let sdk: NodeSDK | null = null;

function parseBooleanEnv(value: string | undefined): boolean {
  return value === 'true' || value === '1';
}

function parseSampleRate(): number {
  const raw = process.env.OTEL_TRACES_SAMPLER_ARG;
  if (!raw) {
    return 0.1;
  }
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 0.1;
  }
  return parsed;
}

function parseMetricsPort(): number {
  const raw = process.env.METRICS_PORT;
  const parsed = raw ? Number.parseInt(raw, 10) : 9464;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 9464;
}

function buildOtlpTracesUrl(): string | undefined {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    return undefined;
  }
  const normalized = endpoint.replace(/\/$/, '');
  if (normalized.endsWith('/v1/traces')) {
    return normalized;
  }
  return `${normalized}/v1/traces`;
}

export function isOtelTracesEnabled(): boolean {
  return parseBooleanEnv(process.env.OTEL_TRACES_ENABLED);
}

export function isMetricsEnabled(): boolean {
  return parseBooleanEnv(process.env.METRICS_ENABLED);
}

export function isObservabilityEnabled(): boolean {
  return isOtelTracesEnabled() || isMetricsEnabled();
}

/**
 * Bootstrap OpenTelemetry tracing and/or Prometheus metrics.
 * Must run before NestFactory.create (import from instrument.ts).
 */
export function initOpenTelemetry(service: OtelServiceName): boolean {
  const tracesEnabled = isOtelTracesEnabled();
  const metricsEnabled = isMetricsEnabled();

  if (!tracesEnabled && !metricsEnabled) {
    return false;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME?.trim() || service;

  const metricReaders = metricsEnabled
    ? [
        new PrometheusExporter({
          port: parseMetricsPort(),
          preventServerStart: false,
        }),
      ]
    : undefined;

  const tracesUrl = buildOtlpTracesUrl();
  const traceExporter =
    tracesEnabled && tracesUrl
      ? new OTLPTraceExporter({ url: tracesUrl })
      : undefined;

  sdk = new NodeSDK({
    serviceName,
    traceExporter,
    metricReaders,
    sampler: tracesEnabled
      ? new ParentBasedSampler({
          root: new TraceIdRatioBasedSampler(parseSampleRate()),
        })
      : undefined,
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.once('SIGTERM', () => {
    void shutdownOpenTelemetry();
  });
  process.once('SIGINT', () => {
    void shutdownOpenTelemetry();
  });

  return true;
}

export async function shutdownOpenTelemetry(): Promise<void> {
  if (!sdk) {
    return;
  }
  const active = sdk;
  sdk = null;
  await active.shutdown();
}
