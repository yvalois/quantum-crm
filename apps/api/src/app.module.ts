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
  CustomFieldDefinitionService,
  ConversationService,
  HistoricalConversationService,
  UnifiedInboxService,
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
import {
  CUSTOM_FIELD_DEFINITION_SERVICE,
  CustomFieldDefinitionsController,
} from "./custom-field-definitions.controller.js";
import { SALES_SERVICE, SalesController } from "./sales.controller.js";
import { TASK_SERVICE, TasksController } from "./tasks.controller.js";
import { IAM_TEAM_SERVICE, TeamsController } from "./teams.controller.js";
import { ProblemDetailsFilter } from "./problem-details.filter.js";
import { BootstrapInitialAdministratorController } from "./bootstrap-initial-administrator.controller.js";
import { AcceptMemberInvitationController } from "./accept-member-invitation.controller.js";
import { BootstrapServiceGuard, BOOTSTRAP_SERVICE_POLICY } from "./bootstrap-service-security.js";
import { AUTOMATION_SERVICE, AutomationsController } from "./automations.controller.js";
import { CONVERSATION_SERVICE, ConversationsController } from "./conversations.controller.js";
import { UNIFIED_INBOX_SERVICE, UnifiedInboxController } from "./unified-inbox.controller.js";
import {
  HISTORICAL_CONVERSATION_SERVICE,
  HistoricalConversationsController,
} from "./historical-conversations.controller.js";
import { CALENDAR_SERVICE, CalendarController } from "./calendar.controller.js";
import { DOCUMENT_SERVICE, DocumentsController } from "./documents.controller.js";
import { FILE_SERVICE, FilesController } from "./files.controller.js";
import { FORM_SERVICE, FormsController } from "./forms.controller.js";
import { InternalAdministratorsController } from "./internal-administrators.controller.js";
import { YCLOUD_BINDING, YCloudWebhookController } from "./ycloud-webhook.controller.js";
import { AgentMcpController } from "./agent-mcp.controller.js";
import type { YCloudBindingConfig } from "@quantum-crm/config";

@Module({})
export class AppModule {
  public static register(
    database: CrmPostgresDatabase,
    verifier: OidcAccessTokenVerifier,
    policy: CrmAuthPolicy,
    iamBootstrapClientId: "quantum-crm-bootstrap",
    activationIssuer?: MemberActivationIssuer,
    fileStorageAuthorization?: FileStorageAuthorization,
    ycloudBinding?: YCloudBindingConfig,
  ): DynamicModule {
    return {
      module: AppModule,
      controllers: [
        HealthController,
        MembersController,
        RolesController,
        ContactsController,
        CustomFieldDefinitionsController,
        SalesController,
        TasksController,
        TeamsController,
        BootstrapInitialAdministratorController,
        AcceptMemberInvitationController,
        InternalAdministratorsController,
        AutomationsController,
        UnifiedInboxController,
        ConversationsController,
        HistoricalConversationsController,
        CalendarController,
        DocumentsController,
        FilesController,
        FormsController,
        YCloudWebhookController,
        AgentMcpController,
      ],
      providers: [
        { provide: POSTGRES_DATABASE, useValue: database },
        { provide: OIDC_ACCESS_TOKEN_VERIFIER, useValue: verifier },
        { provide: CRM_MEMBERSHIPS, useValue: database.memberships },
        { provide: CRM_AUTH_POLICY, useValue: policy },
        { provide: YCLOUD_BINDING, useValue: ycloudBinding },
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
          useFactory: () =>
            new ContactService(
              database.commercial.contacts,
              undefined,
              database.externalParticipants,
            ),
        },
        {
          provide: CUSTOM_FIELD_DEFINITION_SERVICE,
          useFactory: () =>
            new CustomFieldDefinitionService(database.commercial.customFieldDefinitions),
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
              undefined,
              database.externalParticipants,
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
          provide: UNIFIED_INBOX_SERVICE,
          useFactory: () =>
            new UnifiedInboxService(
              database.commercial.unifiedInbox,
              database.externalParticipants,
            ),
        },
        {
          provide: HISTORICAL_CONVERSATION_SERVICE,
          useFactory: () =>
            new HistoricalConversationService(
              database.commercial.historicalConversations,
              {
                contactExistsFor: async (actor, contactId) =>
                  (await database.commercial.contacts.find(actor, contactId)) !== null,
                isActiveMember: async (memberId) =>
                  (await database.members.findById(memberId))?.status === "ACTIVE",
              },
              undefined,
              database.externalParticipants,
            ),
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
            const history = new HistoricalConversationService(
              database.commercial.historicalConversations,
              {
                contactExistsFor: async (actor, contactId) =>
                  (await database.commercial.contacts.find(actor, contactId)) !== null,
                isActiveMember: async (memberId) =>
                  (await database.members.findById(memberId))?.status === "ACTIVE",
              },
            );
            return new FileService(
              database.commercial.files,
              {
                canUseOwner: async (actor, owner) => {
                  if (owner.kind === "library") return true;
                  if (owner.kind !== "existing") return false;
                  if (owner.module === "conversations" && owner.type === "historical_attachment") {
                    return history.canUseAttachmentOwner(actor, owner.id);
                  }
                  if (owner.module === "forms" && owner.type === "form_response") {
                    const upload = await database.commercial.forms.findResponseForOwner(
                      owner.id,
                      new Date(),
                    );
                    return upload !== null && actor.memberId === owner.id;
                  }
                  if (owner.module === "agents" && owner.type === "knowledge_source") {
                    return (
                      actor.scope === "PROFILE" &&
                      (await database.commercial.agentKnowledge.findSource(owner.id)) !== null
                    );
                  }
                  if (owner.module !== "documents") return false;
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
