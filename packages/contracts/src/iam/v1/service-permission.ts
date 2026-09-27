import { z } from "zod";

/**
 * Service permissions are issued by a trusted identity provider to a machine
 * principal. They are deliberately separate from CRM membership permissions:
 * a service token never becomes a human commercial authorization context.
 */
export const ServicePermissionCatalog = ["iam:bootstrap-initial-administrator"] as const;

export const ServicePermissionSchema = z.enum(ServicePermissionCatalog);
export type ServicePermission = z.infer<typeof ServicePermissionSchema>;
