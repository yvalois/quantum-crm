import { createServer, type Server, type ServerResponse } from "node:http";

import { createHealthStatus } from "@quantum-crm/contracts";

export interface HealthServerOptions {
  readonly serviceName: string;
  readonly host: string;
  readonly port: number;
  readonly isReady: () => boolean | Promise<boolean>;
}

export interface HealthServer {
  readonly start: () => Promise<{ host: string; port: number }>;
  readonly close: () => Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function createInternalHealthServer(options: HealthServerOptions): HealthServer {
  const server = createServer((request, response) => {
    void handleRequest(request.method, request.url, response);
  });

  async function handleRequest(
    method: string | undefined,
    url: string | undefined,
    response: ServerResponse,
  ): Promise<void> {
    const check =
      method === "GET" && url === "/health/live"
        ? "live"
        : method === "GET" && url === "/health/ready"
          ? "ready"
          : undefined;

    if (!check) {
      response.writeHead(404, {
        "cache-control": "no-store",
        "content-type": "application/problem+json",
      });
      response.end(JSON.stringify({ status: 404, title: "Not Found" }));
      return;
    }

    let ready = check === "live";
    if (!ready) {
      try {
        ready = await options.isReady();
      } catch {
        ready = false;
      }
    }
    const body = createHealthStatus({ service: options.serviceName, check, ready });
    response.writeHead(ready ? 200 : 503, {
      "cache-control": "no-store",
      "content-type": "application/json",
    });
    response.end(JSON.stringify(body));
  }

  return {
    start: () =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          server.off("error", reject);
          const address = server.address();

          if (!address || typeof address === "string") {
            reject(new Error("Health server did not expose a TCP address"));
            return;
          }

          resolve({ host: options.host, port: address.port });
        });
      }),
    close: () => closeServer(server),
  };
}
