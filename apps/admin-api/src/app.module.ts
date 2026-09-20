import { type DynamicModule, Module } from "@nestjs/common";
import { POSTGRES_DATABASE, type PostgresDatabase } from "@quantum-crm/database";

import { HealthController } from "./health.controller.js";

@Module({})
export class AppModule {
  public static register(database: PostgresDatabase): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [{ provide: POSTGRES_DATABASE, useValue: database }],
    };
  }
}
