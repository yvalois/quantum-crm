import type {
  CustomFieldDefinition,
  CustomFieldDefinitionListQuery,
  CustomFieldModel,
} from "@quantum-crm/contracts";
import { IamAuthorizationError, type IamPermission } from "../iam/index.js";

export type { CustomFieldDefinition, CustomFieldModel } from "@quantum-crm/contracts";

/** Definitions are profile-wide settings, not individual contact or opportunity values. */
export interface CustomFieldDefinitionRepository {
  readonly find: (model: CustomFieldModel, id: string) => Promise<CustomFieldDefinition | null>;
  readonly list: (query: CustomFieldDefinitionListQuery) => Promise<{
    readonly items: readonly CustomFieldDefinition[];
    readonly nextCursor: string | null;
  }>;
}

export class CustomFieldDefinitionValidationError extends Error {
  public constructor() {
    super("Invalid custom field definition query");
    this.name = "CustomFieldDefinitionValidationError";
  }
}

export class CustomFieldDefinitionService {
  public constructor(private readonly repository: CustomFieldDefinitionRepository) {}

  public list(permissions: readonly IamPermission[], query: CustomFieldDefinitionListQuery) {
    if (query.model !== "contact" && query.model !== "opportunity")
      throw new CustomFieldDefinitionValidationError();
    const permission = query.model === "contact" ? "crm:contacts:read" : "crm:sales:read";
    if (!permissions.includes(permission)) throw new IamAuthorizationError();
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      (query.cursor !== undefined && !/^[A-Za-z0-9_-]{1,256}$/u.test(query.cursor))
    )
      throw new CustomFieldDefinitionValidationError();
    return this.repository.list(query);
  }
}
