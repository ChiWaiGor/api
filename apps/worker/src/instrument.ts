import { initOpenTelemetry } from '@app/shared';
import { initSentry } from '@app/shared';

initOpenTelemetry('worker');
initSentry('worker');
