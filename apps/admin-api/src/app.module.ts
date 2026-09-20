import { type DynamicModule, Module } from "@nestjs/common";
import { OIDC_ACCESS_TOKEN_VERIFIER, type OidcAccessTokenVerifier } from "@quantum-crm/auth";
import { POSTGRES_DATABASE, type PostgresDatabase } from "@quantum-crm/database";

import { HealthController } from "./health.controller.js";

@Module({})
export class AppModule {
  public static register(
    database: PostgresDatabase,
    oidcAccessTokenVerifier: OidcAccessTokenVerifier,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: oidcAccessTokenVerifier },
      ],
    };
  }
}
