import { createHash } from "node:crypto";

import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  PreconditionFailedException,
  PreconditionRequiredException,
  Req,
} from "@nestjs/common";
import {
  ContactIdSchema,
  ContactListResponseSchema,
  ContactResponseSchema,
  CreateContactSchema,
  UpdateContactSchema,
  type Contact,
} from "@quantum-crm/contracts";
import {
  ContactNotFoundError,
  ContactService,
  ContactValidationError,
  ContactVersionConflictError,
  IamAuthorizationError,
  type CommercialActor,
  type IamPermission,
} from "@quantum-crm/domain";
import { CommercialIdempotencyConflictError } from "@quantum-crm/database";

import { crmAuthContext, RequireCrmPermission } from "./crm-security.js";

export const CONTACT_SERVICE = Symbol("CONTACT_SERVICE");
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
function payloadHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function expectedVersion(value: string | undefined): bigint {
  const match = typeof value === "string" ? /^"([1-9][0-9]*)"$/u.exec(value) : null;
  if (!match?.[1]) throw new PreconditionRequiredException();
  return BigInt(match[1]);
}
function actor(request: Parameters<typeof crmAuthContext>[0]): {
  readonly actor: CommercialActor;
  readonly permissions: readonly IamPermission[];
} {
  const context = crmAuthContext(request);
  const permissions = context.permissions as readonly IamPermission[];
  return Object.freeze({
    actor: Object.freeze({ memberId: context.principal.id, scope: context.commercialScope }),
    permissions,
  });
}
function contactResponse(contact: {
  readonly id: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly version: bigint;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}) {
  return ContactResponseSchema.parse({
    data: {
      id: contact.id,
      displayName: contact.displayName,
      email: contact.email,
      phone: contact.phone,
      version: contact.version.toString(),
      createdAt: contact.createdAt.toISOString(),
      updatedAt: contact.updatedAt.toISOString(),
    },
  });
}
function mapError(error: unknown): never {
  if (error instanceof IamAuthorizationError) throw new ForbiddenException();
  if (error instanceof ContactNotFoundError) throw new NotFoundException();
  if (error instanceof ContactVersionConflictError) throw new PreconditionFailedException();
  if (error instanceof CommercialIdempotencyConflictError) throw new ConflictException();
  if (error instanceof ContactValidationError) throw new BadRequestException();
  throw error;
}

@Controller("api/v1/contacts")
export class ContactsController {
  public constructor(@Inject(CONTACT_SERVICE) private readonly service: ContactService) {}

  @Get()
  @RequireCrmPermission("crm:contacts:read")
  public async list(@Req() request: Parameters<typeof crmAuthContext>[0]) {
    try {
      const identity = actor(request);
      const contacts = await this.service.list(identity.actor, identity.permissions);
      return ContactListResponseSchema.parse({
        data: contacts.map((contact) => contactResponse(contact).data),
      });
    } catch (error) {
      return mapError(error);
    }
  }

  @Post()
  @RequireCrmPermission("crm:contacts:create")
  public async create(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey || !idempotencyKeyPattern.test(idempotencyKey))
      throw new BadRequestException();
    try {
      const payload = CreateContactSchema.parse(body);
      const identity = actor(request);
      return contactResponse(
        await this.service.create({
          ...identity,
          ...payload,
          idempotencyKey,
          payloadHash: payloadHash(payload),
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Get(":contactId")
  @RequireCrmPermission("crm:contacts:read")
  public async get(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("contactId") contactId: string,
  ) {
    try {
      const identity = actor(request);
      return contactResponse(
        await this.service.get(
          identity.actor,
          identity.permissions,
          ContactIdSchema.parse(contactId),
        ),
      );
    } catch (error) {
      return mapError(error);
    }
  }

  @Patch(":contactId")
  @RequireCrmPermission("crm:contacts:update")
  public async update(
    @Req() request: Parameters<typeof crmAuthContext>[0],
    @Param("contactId") contactId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() body: unknown,
  ) {
    try {
      const payload = UpdateContactSchema.parse(body);
      const identity = actor(request);
      return contactResponse(
        await this.service.update({
          ...identity,
          id: ContactIdSchema.parse(contactId),
          ...payload,
          expectedVersion: expectedVersion(ifMatch),
        }),
      );
    } catch (error) {
      return mapError(error);
    }
  }
}
