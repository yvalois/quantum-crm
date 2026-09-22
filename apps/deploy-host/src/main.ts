import { loadServiceConfig } from "@quantum-crm/config";

import { createHostAdapterServer } from "./host-adapter.js";

const config = loadServiceConfig("deploy-host");
if (!config.deployHostSocketPath) throw new Error("deploy-host socket configuration missing");

const server = createHostAdapterServer({
  socketPath: config.deployHostSocketPath,
  reconciler: {
    reconcile: async () => {
      throw new Error("host compose reconciler is not configured");
    },
  },
});

await server.listen();
