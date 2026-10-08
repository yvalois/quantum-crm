import { describe, expect, it } from "vitest";

import type { DocumentBlock } from "@quantum-crm/contracts";

import { IamAuthorizationError, type CommercialActor, type IamPermission } from "../iam/index.js";
import {
  type CommercialDocumentRecord,
  type DocumentRepository,
  type DocumentTemplateRecord,
  DocumentValidationError,
} from "./index.js";
import { defaultDocumentDesign, DocumentService } from "./document-service.js";

const actor: CommercialActor = {
  memberId: "019db9c7-1268-7d24-bf99-96ea38ebf200",
  scope: "PROFILE",
};
const permissions: readonly IamPermission[] = [
  "crm:documents:read",
  "crm:documents:create",
  "crm:documents:update",
  "crm:documents:templates",
];
const now = new Date("2026-10-01T12:00:00.000Z");

function memoryRepository(seedTemplate?: DocumentTemplateRecord): {
  readonly repository: DocumentRepository;
  readonly documents: () => readonly CommercialDocumentRecord[];
} {
  const documents: CommercialDocumentRecord[] = [];
  const templates: DocumentTemplateRecord[] = seedTemplate ? [seedTemplate] : [];
  const repository: DocumentRepository = {
    list: async () => documents,
    find: async (_actor, id) => documents.find((document) => document.id === id) ?? null,
    create: async ({ document }) => {
      documents.push(document);
      return document;
    },
    update: async (input) => {
      const index = documents.findIndex(
        (document) => document.id === input.id && document.version === input.expectedVersion,
      );
      if (index < 0) return null;
      const current = documents[index]!;
      const updated = Object.freeze({
        ...current,
        title: input.title,
        contactId: input.contactId,
        opportunityId: input.opportunityId,
        blocks: input.blocks,
        design: input.design,
        revision: current.revision + 1,
        version: current.version + 1n,
        updatedAt: input.now,
      });
      documents[index] = updated;
      return updated;
    },
    listTemplates: async (kind) => templates.filter((template) => !kind || template.kind === kind),
    findTemplate: async (id) => templates.find((template) => template.id === id) ?? null,
    createTemplate: async ({ template }) => {
      templates.push(template);
      return template;
    },
    updateTemplate: async (input) => {
      const index = templates.findIndex(
        (template) => template.id === input.id && template.version === input.expectedVersion,
      );
      if (index < 0) return null;
      const current = templates[index]!;
      const updated = Object.freeze({
        ...current,
        name: input.name,
        blocks: input.blocks,
        design: input.design,
        revision: current.revision + 1,
        version: current.version + 1n,
        updatedAt: input.now,
      });
      templates[index] = updated;
      return updated;
    },
  };
  return { repository, documents: () => documents };
}

function template(blocks: readonly DocumentBlock[]): DocumentTemplateRecord {
  return Object.freeze({
    id: "019db9c7-1268-7d24-bf99-96ea38ebf201",
    kind: "QUOTE",
    name: "Propuesta base",
    blocks,
    design: defaultDocumentDesign(),
    revision: 1,
    version: 1n,
    createdAt: now,
    updatedAt: now,
  });
}

describe("DocumentService", () => {
  it("creates an independent draft from a reusable template", async () => {
    const block: DocumentBlock = {
      id: "019db9c7-1268-7d24-bf99-96ea38ebf202",
      type: "TEXT",
      locked: false,
      content: "Hola",
      align: "LEFT",
    };
    const seededTemplate = template([block]);
    const memory = memoryRepository(seededTemplate);
    const service = new DocumentService(memory.repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
    });

    const created = await service.create({
      actor,
      permissions,
      kind: "QUOTE",
      title: "Propuesta",
      contactId: null,
      opportunityId: null,
      templateId: seededTemplate.id,
      idempotencyKey: "document-create-1",
      payloadHash: "a".repeat(64),
      now,
    });

    expect(created).toMatchObject({
      sourceTemplateId: seededTemplate.id,
      revision: 1,
      version: 1n,
    });
    expect(created.blocks).toEqual(seededTemplate.blocks);
    expect(created.blocks).not.toBe(seededTemplate.blocks);
  });

  it("snapshots client and advisor values while creating an instance from a template", async () => {
    const seededTemplate = template([
      {
        id: "019db9c7-1268-7d24-bf99-96ea38ebf121",
        type: "TEXT",
        locked: true,
        content: "Propuesta para {{contact.name}} preparada por {{advisor.name}}",
        align: "LEFT",
        style: "TITLE",
        bold: true,
        italic: false,
        underline: false,
      },
      {
        id: "019db9c7-1268-7d24-bf99-96ea38ebf122",
        type: "VARIABLE",
        locked: true,
        key: "contact.email",
        label: "Correo del cliente",
        fallback: "Sin correo",
        value: null,
        editable: true,
      },
      {
        id: "019db9c7-1268-7d24-bf99-96ea38ebf124",
        type: "VARIABLE",
        locked: true,
        key: "opportunity.amount",
        label: "Valor de la oportunidad",
        fallback: "Sin valor",
        value: null,
        editable: false,
      },
      {
        id: "019db9c7-1268-7d24-bf99-96ea38ebf126",
        type: "COLUMNS",
        locked: true,
        layout: "LEFT_WIDE",
        columns: ["Cliente: {{contact.name}}", "{{advisor.name}}"],
        cells: [
          {
            id: "019db9c7-1268-7d24-bf99-96ea38ebf127",
            items: [
              {
                id: "019db9c7-1268-7d24-bf99-96ea38ebf128",
                type: "TEXT",
                locked: false,
                content: "Cliente: {{contact.name}}",
                align: "LEFT",
                style: "CAPTION",
                bold: false,
                italic: true,
                underline: false,
              },
            ],
          },
          {
            id: "019db9c7-1268-7d24-bf99-96ea38ebf129",
            items: [
              {
                id: "019db9c7-1268-7d24-bf99-96ea38ebf130",
                type: "VARIABLE",
                locked: false,
                key: "advisor.name",
                label: "Asesora",
                fallback: "Sin asesora",
                value: null,
                editable: false,
              },
            ],
          },
        ],
      },
    ]);
    const memory = memoryRepository(seededTemplate);
    const service = new DocumentService(memory.repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
      contactFor: async () => ({
        displayName: "Andrea Cliente",
        email: "andrea@example.test",
        phone: null,
      }),
      memberFor: async () => ({ displayName: "Sofía Asesora", email: "sofia@example.test" }),
      opportunityFor: async () => ({
        title: "Implementacion anual",
        amountMinor: 125050n,
        currency: "COP",
        status: "OPEN",
      }),
    });

    const created = await service.create({
      actor,
      permissions,
      kind: "QUOTE",
      title: "Propuesta octubre",
      contactId: "019db9c7-1268-7d24-bf99-96ea38ebf123",
      opportunityId: "019db9c7-1268-7d24-bf99-96ea38ebf125",
      templateId: seededTemplate.id,
      idempotencyKey: "document-create-context-1",
      payloadHash: "d".repeat(64),
      now,
    });

    expect(created.blocks).toMatchObject([
      { content: "Propuesta para Andrea Cliente preparada por Sofía Asesora" },
      { value: "andrea@example.test", editable: true },
      { value: "COP 1250.50", editable: false },
      {
        layout: "LEFT_WIDE",
        columns: ["Cliente: Andrea Cliente", "Sofía Asesora"],
        cells: [
          { items: [{ content: "Cliente: Andrea Cliente" }] },
          { items: [{ value: "Sofía Asesora" }] },
        ],
      },
    ]);

    expect(created.blocks[0]).toMatchObject({
      type: "TEXT",
      style: "TITLE",
      bold: true,
      italic: false,
      underline: false,
    });
    expect(created.blocks[3]).toMatchObject({
      type: "COLUMNS",
      cells: [
        {
          items: [
            {
              type: "TEXT",
              style: "CAPTION",
              bold: false,
              italic: true,
              underline: false,
            },
          ],
        },
      ],
    });
  });

  it("prevents changing a protected template block in an instance", async () => {
    const protectedBlock: DocumentBlock = {
      id: "019db9c7-1268-7d24-bf99-96ea38ebf203",
      type: "TEXT",
      locked: true,
      content: "Legal",
      align: "LEFT",
    };
    const seededTemplate = template([protectedBlock]);
    const memory = memoryRepository(seededTemplate);
    const service = new DocumentService(memory.repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
    });
    const created = await service.create({
      actor,
      permissions,
      kind: "QUOTE",
      title: "Protegida",
      contactId: null,
      opportunityId: null,
      templateId: seededTemplate.id,
      idempotencyKey: "document-create-2",
      payloadHash: "b".repeat(64),
      now,
    });

    await expect(
      service.update({
        actor,
        permissions,
        id: created.id,
        expectedVersion: 1n,
        patch: { blocks: [{ ...protectedBlock, content: "Alterado" }] },
        idempotencyKey: "document-update-1",
        payloadHash: "c".repeat(64),
        now,
      }),
    ).rejects.toBeInstanceOf(DocumentValidationError);
  });

  it("allows replacing a protected image slot after PostgreSQL reorders JSON properties", async () => {
    const protectedImage: DocumentBlock = {
      id: "019db9c7-1268-7d24-bf99-96ea38ebf204",
      type: "IMAGE",
      locked: true,
      label: "Imagen principal",
      alt: "Producto",
      caption: "",
      fileId: null,
      checksum: null,
      replaceable: true,
      visible: true,
      width: "FULL",
      align: "CENTER",
      fit: "COVER",
    };
    const seededTemplate = template([protectedImage]);
    const memory = memoryRepository(seededTemplate);
    const service = new DocumentService(memory.repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
    });
    const created = await service.create({
      actor,
      permissions,
      kind: "QUOTE",
      title: "Imagen reemplazable",
      contactId: null,
      opportunityId: null,
      templateId: seededTemplate.id,
      idempotencyKey: "document-create-image-slot-1",
      payloadHash: "e".repeat(64),
      now,
    });
    const reorderedCandidate: DocumentBlock = {
      visible: true,
      replaceable: true,
      checksum: `sha256:${"f".repeat(64)}`,
      fileId: "019db9c7-1268-7d24-bf99-96ea38ebf205",
      caption: "",
      alt: "Producto",
      label: "Imagen principal",
      type: "IMAGE",
      locked: true,
      id: protectedImage.id,
      width: "FULL",
      align: "CENTER",
      fit: "COVER",
    };

    const updated = await service.update({
      actor,
      permissions,
      id: created.id,
      expectedVersion: 1n,
      patch: { blocks: [reorderedCandidate] },
      idempotencyKey: "document-update-image-slot-1",
      payloadHash: "f".repeat(64),
      now,
    });

    expect(updated.blocks[0]).toMatchObject({
      fileId: reorderedCandidate.fileId,
      checksum: reorderedCandidate.checksum,
    });
  });

  it("allows replacing a protected image nested in a column without unlocking its layout", async () => {
    const protectedColumns: DocumentBlock = {
      id: "019db9c7-1268-7d24-bf99-96ea38ebf210",
      type: "COLUMNS",
      locked: true,
      layout: "LEFT_WIDE",
      columns: ["[Imagen: Vehiculo]", "Datos comerciales"],
      cells: [
        {
          id: "019db9c7-1268-7d24-bf99-96ea38ebf211",
          items: [
            {
              id: "019db9c7-1268-7d24-bf99-96ea38ebf212",
              type: "IMAGE",
              locked: false,
              label: "Vehiculo",
              alt: "Vehiculo seleccionado",
              caption: "",
              fileId: null,
              checksum: null,
              replaceable: true,
              visible: true,
              width: "FULL",
              align: "CENTER",
              fit: "COVER",
            },
          ],
        },
        {
          id: "019db9c7-1268-7d24-bf99-96ea38ebf213",
          items: [
            {
              id: "019db9c7-1268-7d24-bf99-96ea38ebf214",
              type: "TEXT",
              locked: false,
              content: "Datos comerciales",
              align: "LEFT",
            },
          ],
        },
      ],
    };
    const memory = memoryRepository(template([protectedColumns]));
    const service = new DocumentService(memory.repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
    });
    const created = await service.create({
      actor,
      permissions,
      kind: "QUOTE",
      title: "Imagen en columnas",
      contactId: null,
      opportunityId: null,
      templateId: "019db9c7-1268-7d24-bf99-96ea38ebf201",
      idempotencyKey: "document-create-column-image-1",
      payloadHash: "1".repeat(64),
      now,
    });
    const currentColumns = created.blocks[0];
    expect(currentColumns?.type).toBe("COLUMNS");
    if (!currentColumns || currentColumns.type !== "COLUMNS" || !currentColumns.cells) return;
    const replacement = {
      ...currentColumns,
      cells: currentColumns.cells.map((cell, cellIndex) => ({
        ...cell,
        items: cell.items.map((item) =>
          cellIndex === 0 && item.type === "IMAGE"
            ? {
                ...item,
                fileId: "019db9c7-1268-7d24-bf99-96ea38ebf215",
                checksum: `sha256:${"b".repeat(64)}`,
              }
            : item,
        ),
      })),
    } satisfies DocumentBlock;

    const updated = await service.update({
      actor,
      permissions,
      id: created.id,
      expectedVersion: 1n,
      patch: { blocks: [replacement] },
      idempotencyKey: "document-update-column-image-1",
      payloadHash: "2".repeat(64),
      now,
    });

    expect(updated.blocks[0]).toMatchObject({
      locked: true,
      layout: "LEFT_WIDE",
      cells: [
        {
          items: [
            {
              fileId: "019db9c7-1268-7d24-bf99-96ea38ebf215",
              checksum: `sha256:${"b".repeat(64)}`,
            },
          ],
        },
      ],
    });
  });

  it("keeps header and footer configuration through update and duplication", async () => {
    const memory = memoryRepository();
    const service = new DocumentService(memory.repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
    });
    const created = await service.create({
      actor,
      permissions,
      kind: "QUOTE",
      title: "Documento editorial",
      contactId: null,
      opportunityId: null,
      templateId: null,
      design: {
        ...defaultDocumentDesign(),
        headerText: "InterAmerican Car Rental",
        headerLayout: "LOGO_TEXT",
        headerAlign: "RIGHT",
        headerSpacing: "SPACIOUS",
        footerText: "Documento confidencial",
        footerAlign: "CENTER",
        footerSpacing: "COMPACT",
      },
      idempotencyKey: "document-create-editorial-1",
      payloadHash: "3".repeat(64),
      now,
    });
    const updated = await service.update({
      actor,
      permissions,
      id: created.id,
      expectedVersion: 1n,
      patch: {
        design: {
          ...created.design,
          headerText: "Propuesta comercial",
          footerText: "Pagina contractual",
          showPageNumbers: false,
        },
      },
      idempotencyKey: "document-update-editorial-1",
      payloadHash: "4".repeat(64),
      now,
    });
    const duplicated = await service.duplicate({
      actor,
      permissions,
      sourceId: updated.id,
      idempotencyKey: "document-duplicate-editorial-1",
      payloadHash: "5".repeat(64),
      now,
    });
    const savedTemplate = await service.createTemplate({
      actor,
      permissions,
      name: "Plantilla editorial",
      sourceDocumentId: updated.id,
      idempotencyKey: "document-template-editorial-1",
      payloadHash: "6".repeat(64),
      now,
    });

    expect(duplicated.design).toEqual(updated.design);
    expect(duplicated.design).not.toBe(updated.design);
    expect(savedTemplate.design).toEqual(updated.design);
    expect(savedTemplate.design).not.toBe(updated.design);
    expect(duplicated.design).toMatchObject({
      headerText: "Propuesta comercial",
      headerLayout: "LOGO_TEXT",
      headerAlign: "RIGHT",
      headerSpacing: "SPACIOUS",
      footerText: "Pagina contractual",
      footerAlign: "CENTER",
      footerSpacing: "COMPACT",
      showPageNumbers: false,
    });
  });

  it("denies reads when the authenticated member lacks document permission", async () => {
    const service = new DocumentService(memoryRepository().repository, {
      contactExistsFor: async () => true,
      opportunityExistsFor: async () => true,
    });
    await expect(service.list(actor, [], {})).rejects.toBeInstanceOf(IamAuthorizationError);
  });
});
