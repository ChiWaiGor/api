import { initOpenTelemetry } from '@app/shared';
import { initSentry } from '@app/shared';

initOpenTelemetry('api');
initSentry('api');
