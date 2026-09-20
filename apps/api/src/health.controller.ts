import { Controller, Get } from "@nestjs/common";
import { createHealthStatus, type HealthStatus } from "@quantum-crm/contracts";

@Controller("health")
export class HealthController {
  @Get("live")
  public live(): HealthStatus {
    return createHealthStatus({ service: "api", check: "live" });
  }

  @Get("ready")
  public ready(): HealthStatus {
    return createHealthStatus({ service: "api", check: "ready" });
  }
}
