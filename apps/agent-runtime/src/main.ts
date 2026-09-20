import { loadServiceConfig } from "@quantum-crm/config";
import { createInternalHealthServer, registerGracefulShutdown } from "@quantum-crm/observability";

async function bootstrap(): Promise<void> {
  const config = loadServiceConfig("agent-runtime");
  let ready = false;
  const healthServer = createInternalHealthServer({
    serviceName: config.serviceName,
    host: config.host,
    port: config.port,
    isReady: () => ready,
  });

  await healthServer.start();
  ready = true;
  registerGracefulShutdown([healthServer], config.shutdownTimeoutMs);
}

void bootstrap().catch(() => {
  process.stderr.write("agent-runtime failed to start\n");
  process.exitCode = 1;
});
