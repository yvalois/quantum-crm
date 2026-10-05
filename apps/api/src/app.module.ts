import { type DynamicModule, Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import {
  OIDC_ACCESS_TOKEN_VERIFIER,
  type CrmAuthPolicy,
  type OidcAccessTokenVerifier,
} from "@quantum-crm/auth";
import { POSTGRES_DATABASE, type CrmPostgresDatabase } from "@quantum-crm/database";
import {
  ContactService,
  ConversationService,
  IamMemberService,
  IamRoleService,
  IamTeamService,
  SalesService,
  TaskService,
  AutomationService,
  CalendarService,
  DocumentService,
  FileService,
  FormService,
  type FileStorageAuthorization,
} from "@quantum-crm/domain";

import {
  CrmAuthenticationGuard,
  CrmAuthorizationGuard,
  CRM_AUTH_POLICY,
  CRM_MEMBERSHIPS,
  IAM_INVITATION_ACTIVATION_REPOSITORY,
  IAM_MEMBER_SERVICE,
} from "./crm-security.js";
import { HealthController } from "./health.controller.js";
import { MembersController } from "./members.controller.js";
import { MEMBER_ACTIVATION_ISSUER } from "./members.controller.js";
import type { MemberActivationIssuer } from "./member-activation-issuer.js";
import { IAM_ROLE_SERVICE, RolesController } from "./roles.controller.js";
import { CONTACT_SERVICE, ContactsController } from "./contacts.controller.js";
import { SALES_SERVICE, SalesController } from "./sales.controller.js";
import { TASK_SERVICE, TasksController } from "./tasks.controller.js";
import { IAM_TEAM_SERVICE, TeamsController } from "./teams.controller.js";
import { ProblemDetailsFilter } from "./problem-details.filter.js";
import { BootstrapInitialAdministratorController } from "./bootstrap-initial-administrator.controller.js";
import { AcceptMemberInvitationController } from "./accept-member-invitation.controller.js";
import { BootstrapServiceGuard, BOOTSTRAP_SERVICE_POLICY } from "./bootstrap-service-security.js";
import { AUTOMATION_SERVICE, AutomationsController } from "./automations.controller.js";
import { CONVERSATION_SERVICE, ConversationsController } from "./conversations.controller.js";
import { CALENDAR_SERVICE, CalendarController } from "./calendar.controller.js";
import { DOCUMENT_SERVICE, DocumentsController } from "./documents.controller.js";
import { FILE_SERVICE, FilesController } from "./files.controller.js";
import { FORM_SERVICE, FormsController } from "./forms.controller.js";

@Module({})
export class AppModule {
  public static register(
    database: CrmPostgresDatabase,
    verifier: OidcAccessTokenVerifier,
    policy: CrmAuthPolicy,
    iamBootstrapClientId: "quantum-crm-bootstrap",
    activationIssuer?: MemberActivationIssuer,
    fileStorageAuthorization?: FileStorageAuthorization,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        MembersController,
        RolesController,
        ContactsController,
        SalesController,
        TasksController,
        TeamsController,
        BootstrapInitialAdministratorController,
        AcceptMemberInvitationController,
        AutomationsController,
        ConversationsController,
        CalendarController,
        DocumentsController,
        FilesController,
        FormsController,
      ],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: CRM_MEMBERSHIPS, useValue: database.memberships },
        { provide: CRM_AUTH_POLICY, useValue: policy },
        {
          provide: BOOTSTRAP_SERVICE_POLICY,
          useValue: { clientId: iamBootstrapClientId, audience: "quantum-crm-api" },
        },
        BootstrapServiceGuard,
        { provide: IAM_MEMBER_SERVICE, useFactory: () => new IamMemberService(database.members) },
        { provide: IAM_ROLE_SERVICE, useFactory: () => new IamRoleService(database.roles) },
        { provide: IAM_TEAM_SERVICE, useFactory: () => new IamTeamService(database.teams) },
        {
          provide: IAM_INVITATION_ACTIVATION_REPOSITORY,
          useValue: database.invitationActivations,
        },
        { provide: MEMBER_ACTIVATION_ISSUER, useValue: activationIssuer },
        {
          provide: CONTACT_SERVICE,
          useFactory: () => new ContactService(database.commercial.contacts),
        },
        {
          provide: SALES_SERVICE,
          useFactory: () =>
            new SalesService(
              database.commercial.sales,
              {
                existsFor: async (actor, contactId) =>
                  (await database.commercial.contacts.find(actor, contactId)) !== null,
              },
              {
                isActive: async (memberId) =>
                  (await database.members.findById(memberId))?.status === "ACTIVE",
              },
            ),
        },
        {
          provide: TASK_SERVICE,
          useFactory: () =>
            new TaskService(database.commercial.tasks, {
              contactExistsFor: async (actor, contactId) =>
                (await database.commercial.contacts.find(actor, contactId)) !== null,
              opportunityExistsFor: async (actor, opportunityId) =>
                (await database.commercial.sales.findOpportunity(actor, opportunityId)) !== null,
              isActiveMember: async (memberId) =>
                (await database.members.findById(memberId))?.status === "ACTIVE",
              activeAssignees: async () =>
                new IamMemberService(database.members).listActiveForTaskAssignment(),
            }),
        },
        {
          provide: AUTOMATION_SERVICE,
          useFactory: () => new AutomationService(database.commercial.automation),
        },
        {
          provide: CONVERSATION_SERVICE,
          useFactory: () =>
            new ConversationService(database.commercial.conversations, {
              contactExistsFor: async (actor, contactId) =>
                (await database.commercial.contacts.find(actor, contactId)) !== null,
              isActiveMember: async (memberId) =>
                (await database.members.findById(memberId))?.status === "ACTIVE",
              documentFor: async (actor, documentId) =>
                database.commercial.documents.find(actor, documentId),
            }),
        },
        {
          provide: CALENDAR_SERVICE,
          useFactory: () =>
            new CalendarService(database.commercial.calendar, {
              contactExistsFor: async (actor, contactId) =>
                (await database.commercial.contacts.find(actor, contactId)) !== null,
              opportunityExistsFor: async (actor, opportunityId) =>
                (await database.commercial.sales.findOpportunity(actor, opportunityId)) !== null,
              isActiveMember: async (memberId) =>
                (await database.members.findById(memberId))?.status === "ACTIVE",
            }),
        },
        {
          provide: DOCUMENT_SERVICE,
          useFactory: () =>
            new DocumentService(database.commercial.documents, {
              contactExistsFor: async (actor, contactId) =>
                (await database.commercial.contacts.find(actor, contactId)) !== null,
              opportunityExistsFor: async (actor, opportunityId) =>
                (await database.commercial.sales.findOpportunity(actor, opportunityId)) !== null,
              contactFor: async (actor, contactId) => {
                const contact = await database.commercial.contacts.find(actor, contactId);
                return contact
                  ? {
                      displayName: contact.displayName,
                      email: contact.email,
                      phone: contact.phone,
                    }
                  : null;
              },
              memberFor: async (memberId) => {
                const member = await database.members.findById(memberId);
                return member ? { displayName: member.displayName, email: member.email } : null;
              },
              opportunityFor: async (actor, opportunityId) => {
                const opportunity = await database.commercial.sales.findOpportunity(
                  actor,
                  opportunityId,
                );
                return opportunity
                  ? {
                      title: opportunity.title,
                      amountMinor: opportunity.amountMinor,
                      currency: opportunity.currency,
                      status: opportunity.status,
                    }
                  : null;
              },
            }),
        },
        {
          provide: FILE_SERVICE,
          useFactory: () => {
            if (!fileStorageAuthorization) {
              throw new Error("File storage authorization is required");
            }
            return new FileService(
              database.commercial.files,
              {
                canUseOwner: async (actor, owner) => {
                  if (owner.kind !== "existing" || owner.module !== "documents") return false;
                  if (owner.type === "commercial_document") {
                    return (await database.commercial.documents.find(actor, owner.id)) !== null;
                  }
                  if (owner.type === "document_template") {
                    return (await database.commercial.documents.findTemplate(owner.id)) !== null;
                  }
                  return false;
                },
              },
              fileStorageAuthorization,
            );
          },
        },
        {
          provide: FORM_SERVICE,
          useFactory: () => new FormService(database.commercial.forms),
        },
        { provide: APP_GUARD, useClass: CrmAuthenticationGuard },
        { provide: APP_GUARD, useClass: CrmAuthorizationGuard },
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
      ],
    };
  }
}
