import { Controller, Get, Inject, Res } from "@nestjs/common";
import { createHealthStatus, type HealthStatus } from "@quantum-crm/contracts";
import { POSTGRES_DATABASE, type PostgresDatabase } from "@quantum-crm/database";

interface StatusResponse {
  readonly status: (code: number) => unknown;
}

@Controller("health")
export class HealthController {
  public constructor(
    @Inject(POSTGRES_DATABASE) private readonly database: Pick<PostgresDatabase, "isReady">,
  ) {}

  @Get("live")
  public live(): HealthStatus {
    return createHealthStatus({ service: "api", check: "live" });
  }

  @Get("ready")
  public async ready(@Res({ passthrough: true }) response: StatusResponse): Promise<HealthStatus> {
    const ready = await this.database.isReady();
    response.status(ready ? 200 : 503);
    return createHealthStatus({
      service: "api",
      check: "ready",
      ready,
    });
  }
}
