import { z } from "zod";

export const FileIdSchema = z.string().uuid();
const TimestampSchema = z.string().datetime({ offset: true });
const OpaqueStorageValueSchema = z.string().min(1).max(2_048);
const Sha256Base64Schema = z
  .string()
  .regex(/^[A-Za-z0-9+/]{43}=$/u, "Expected a 32-byte SHA-256 encoded as RFC 4648 Base64");

export const FileClassSchema = z.enum(["IMAGE", "AUDIO", "DOCUMENT", "VIDEO"]);
export const FileStatusSchema = z.enum([
  "PENDING",
  "UPLOADED",
  "SCANNING",
  "QUARANTINED",
  "PROMOTING",
  "AVAILABLE",
  "REJECTED",
  "FAILED",
  "DELETE_SCHEDULED",
  "DELETE_PENDING",
  "DELETED",
]);

export const FileOwnerModuleSchema = z.enum([
  "documents",
  "conversations",
  "forms",
  "catalog",
]);
export const FileOwnerTypeSchema = z.enum([
  "commercial_document",
  "document_template",
  "conversation",
  "message",
  "form_response",
  "product",
  "variant",
]);

const ExistingFileOwnerSchema = z
  .object({
    kind: z.literal("existing"),
    module: FileOwnerModuleSchema,
    type: FileOwnerTypeSchema,
    id: z.string().uuid(),
  })
  .strict()
  .superRefine((owner, context) => {
    const allowedTypes: Readonly<
      Record<z.infer<typeof FileOwnerModuleSchema>, readonly string[]>
    > = {
      documents: ["commercial_document", "document_template"],
      conversations: ["conversation", "message"],
      forms: ["form_response"],
      catalog: ["product", "variant"],
    };
    if (!allowedTypes[owner.module].includes(owner.type)) {
      context.addIssue({
        code: "custom",
        path: ["type"],
        message: "Owner type is not valid for its module",
      });
    }
  });

const ClaimedFileOwnerSchema = z
  .object({
    kind: z.literal("claim"),
    attachmentClaimId: z.string().uuid(),
  })
  .strict();

export const FileOwnerSchema = z.union([ExistingFileOwnerSchema, ClaimedFileOwnerSchema]);

const MaximumBytesByClass: Readonly<Record<z.infer<typeof FileClassSchema>, number>> = {
  IMAGE: 20 * 1024 * 1024,
  AUDIO: 50 * 1024 * 1024,
  DOCUMENT: 50 * 1024 * 1024,
  VIDEO: 250 * 1024 * 1024,
};

export const CreateFileUploadIntentSchema = z
  .object({
    owner: FileOwnerSchema,
    fileClass: FileClassSchema,
    originalName: z.string().trim().min(1).max(255),
    declaredMime: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/u)
      .max(160),
    declaredSize: z.number().int().positive(),
    expectedSha256: Sha256Base64Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.declaredSize > MaximumBytesByClass[value.fileClass]) {
      context.addIssue({
        code: "custom",
        path: ["declaredSize"],
        message: "File exceeds the maximum size for its class",
      });
    }
  });

export const FileSchema = z
  .object({
    id: FileIdSchema,
    status: FileStatusSchema,
    fileClass: FileClassSchema,
    name: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(160),
    size: z.number().int().positive(),
    sha256: Sha256Base64Schema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();

export const FileResponseSchema = z.object({ data: FileSchema }).strict();
export const FileListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    status: FileStatusSchema.optional(),
    fileClass: FileClassSchema.optional(),
  })
  .strict();
export const FileListResponseSchema = z
  .object({
    data: z.array(FileSchema).max(100),
    page: z.object({ nextCursor: z.string().min(1).max(512).nullable() }).strict(),
  })
  .strict();

const BrowserPostFieldsSchema = z
  .record(z.string().min(1).max(128), z.string().max(8_192))
  .refine((fields) => Object.keys(fields).length <= 32, "Too many upload form fields");
export const FileUploadIntentResponseSchema = z
  .object({
    data: z
      .object({
        file: FileSchema,
        upload: z
          .object({
            method: z.literal("POST"),
            url: z.string().url().max(8_192),
            fields: BrowserPostFieldsSchema,
            expiresAt: TimestampSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const CompleteFileUploadSchema = z
  .object({
    versionId: OpaqueStorageValueSchema,
    checksum: Sha256Base64Schema,
    receipt: OpaqueStorageValueSchema,
  })
  .strict();

export const FileOperationStatusSchema = z.enum(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);
export const FileOperationSchema = z
  .object({
    id: z.string().uuid(),
    fileId: FileIdSchema,
    status: FileOperationStatusSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict();
export const FileOperationResponseSchema = z.object({ data: FileOperationSchema }).strict();

export const FileReferenceKindSchema = z.enum([
  "INLINE_IMAGE",
  "ATTACHMENT",
  "LOGO",
  "BACKGROUND",
  "SIGNATURE",
]);
export const CreateFileReferenceSchema = z
  .object({
    owner: ExistingFileOwnerSchema,
    kind: FileReferenceKindSchema,
  })
  .strict();
export const FileReferenceSchema = z
  .object({
    id: z.string().uuid(),
    fileId: FileIdSchema,
    owner: ExistingFileOwnerSchema,
    kind: FileReferenceKindSchema,
    createdAt: TimestampSchema,
  })
  .strict();
export const FileReferenceResponseSchema = z.object({ data: FileReferenceSchema }).strict();

export const CreateFileDownloadAuthorizationSchema = z.object({}).strict();
export const FileDownloadAuthorizationResponseSchema = z
  .object({
    data: z
      .object({
        method: z.literal("GET"),
        url: z.string().url().max(8_192),
        expiresAt: TimestampSchema,
        objectVersionId: OpaqueStorageValueSchema,
      })
      .strict(),
  })
  .strict();

export type FileClass = z.infer<typeof FileClassSchema>;
export type FileStatus = z.infer<typeof FileStatusSchema>;
export type FileOwner = z.infer<typeof FileOwnerSchema>;
export type FileContract = z.infer<typeof FileSchema>;
export type FileListQuery = z.infer<typeof FileListQuerySchema>;
export type CreateFileUploadIntent = z.infer<typeof CreateFileUploadIntentSchema>;
export type CompleteFileUpload = z.infer<typeof CompleteFileUploadSchema>;
export type FileOperation = z.infer<typeof FileOperationSchema>;
export type FileReferenceKind = z.infer<typeof FileReferenceKindSchema>;
export type CreateFileReference = z.infer<typeof CreateFileReferenceSchema>;
export type FileReference = z.infer<typeof FileReferenceSchema>;
export type CreateFileDownloadAuthorization = z.infer<
  typeof CreateFileDownloadAuthorizationSchema
>;
