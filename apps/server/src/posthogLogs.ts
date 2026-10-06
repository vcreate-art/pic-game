import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { logs } from '@opentelemetry/api-logs';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchLogRecordProcessor } from '@opentelemetry/sdk-logs';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (existsSync('.env')) loadEnvFile();

const posthogKey = process.env.VITE_POSTHOG_KEY;
const posthogHost = process.env.VITE_POSTHOG_HOST;
const isPostHogLogsEnabled = Boolean(posthogKey && posthogHost);

if (!isPostHogLogsEnabled && process.env.NODE_ENV !== 'production') {
  const missingVariable = posthogKey ? 'VITE_POSTHOG_HOST' : 'VITE_POSTHOG_KEY';
  throw new Error(
    `${missingVariable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${missingVariable} is configured`,
  );
}

const sdk = posthogKey && posthogHost
  ? new NodeSDK({
      resource: resourceFromAttributes({
        'service.name': 'pic-game-server',
        'deployment.environment': process.env.NODE_ENV ?? 'development',
      }),
      logRecordProcessors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: new URL('/i/v1/logs', posthogHost).toString(),
            headers: { Authorization: `Bearer ${posthogKey}` },
          }),
        }),
      ],
    })
  : undefined;

sdk?.start();

const posthogLogger = logs.getLogger('pic-game-posthog-exporter');

export function logServerLifecycle(event: 'server_started' | 'server_stopping') {
  if (!isPostHogLogsEnabled) return;
  posthogLogger.emit({
    severityText: 'INFO',
    body: 'pic-game server lifecycle',
    attributes: { event },
  });
}

export async function shutdownPostHogLogs() {
  await sdk?.shutdown();
}
