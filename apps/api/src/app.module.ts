import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  type CrmAuthPolicy,
  type OidcAccessTokenVerifier,
} from "@quantum-crm/auth";
import { POSTGRES_DATABASE, type CrmPostgresDatabase } from "@quantum-crm/database";
import { ContactService, IamMemberService, SalesService, TaskService } from "@quantum-crm/domain";

import {
  CrmAuthenticationGuard,
  CrmAuthorizationGuard,
  CRM_AUTH_POLICY,
  CRM_MEMBERSHIPS,
} from "./crm-security.js";
import { HealthController } from "./health.controller.js";
import { IAM_MEMBER_SERVICE, MembersController } from "./members.controller.js";
import { CONTACT_SERVICE, ContactsController } from "./contacts.controller.js";
import { SALES_SERVICE, SalesController } from "./sales.controller.js";
import { TASK_SERVICE, TasksController } from "./tasks.controller.js";
import { ProblemDetailsFilter } from "./problem-details.filter.js";
import { BootstrapInitialAdministratorController } from "./bootstrap-initial-administrator.controller.js";
import { BootstrapServiceGuard, BOOTSTRAP_SERVICE_POLICY } from "./bootstrap-service-security.js";

@Module({})
export class AppModule {
  public static register(
    database: CrmPostgresDatabase,
    verifier: OidcAccessTokenVerifier,
    policy: CrmAuthPolicy,
    iamBootstrapClientId: "quantum-crm-bootstrap",
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, MembersController, ContactsController, SalesController, TasksController, BootstrapInitialAdministratorController],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: CRM_MEMBERSHIPS, useValue: database.memberships },
        { provide: CRM_AUTH_POLICY, useValue: policy },
        { provide: BOOTSTRAP_SERVICE_POLICY, useValue: { clientId: iamBootstrapClientId, audience: "quantum-crm-api" } },
        BootstrapServiceGuard,
        { provide: IAM_MEMBER_SERVICE, useFactory: () => new IamMemberService(database.members) },
        { provide: CONTACT_SERVICE, useFactory: () => new ContactService(database.commercial.contacts) },
        {
          provide: SALES_SERVICE,
          useFactory: () =>
            new SalesService(database.commercial.sales, {
              existsFor: async (actor, contactId) =>
                (await database.commercial.contacts.find(actor, contactId)) !== null,
            }),
        },
        {
          provide: TASK_SERVICE,
          useFactory: () =>
            new TaskService(database.commercial.tasks, {
              contactExistsFor: async (actor, contactId) =>
                (await database.commercial.contacts.find(actor, contactId)) !== null,
              opportunityExistsFor: async (actor, opportunityId) =>
                (await database.commercial.sales.findOpportunity(actor, opportunityId)) !== null,
              isActiveMember: async (memberId) => (await database.members.findById(memberId))?.status === "ACTIVE",
              activeAssignees: async () => new IamMemberService(database.members).listActiveForTaskAssignment(),
            }),
        },
        { provide: APP_GUARD, useClass: CrmAuthenticationGuard },
        { provide: APP_GUARD, useClass: CrmAuthorizationGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
