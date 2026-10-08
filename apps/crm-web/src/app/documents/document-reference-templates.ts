import type { DocumentBlock, DocumentDesign } from "@quantum-crm/contracts";

export const referenceTemplateKeys = ["TRANSFER_SEDAN", "RENTAL_SUV"] as const;
export type ReferenceTemplateKey = (typeof referenceTemplateKeys)[number];

export interface DocumentReferenceBlueprint {
  readonly name: string;
  readonly title: string;
  readonly blocks: readonly DocumentBlock[];
  readonly design: DocumentDesign;
}

type TableCellStyle = NonNullable<
  NonNullable<
    Extract<DocumentBlock, { readonly type: "TABLE" }>["grid"]
  >["rows"][number]["cells"][number]["style"]
>;

function id(): string {
  return crypto.randomUUID();
}

function text(
  content: string,
  options: Partial<Extract<DocumentBlock, { readonly type: "TEXT" }>> = {},
): DocumentBlock {
  return {
    id: id(),
    type: "TEXT",
    locked: false,
    content,
    align: "LEFT",
    style: "BODY",
    fontFamily: "SANS",
    fontSize: 10,
    bold: false,
    italic: false,
    underline: false,
    ...options,
  };
}

function image(label: string): DocumentBlock {
  return {
    id: id(),
    type: "IMAGE",
    locked: false,
    label,
    alt: label,
    caption: "",
    fileId: null,
    checksum: null,
    replaceable: true,
    visible: true,
    width: "FULL",
    widthPercent: 100,
    align: "CENTER",
    fit: "CONTAIN",
    aspectRatio: "AUTO",
    focalX: 50,
    focalY: 50,
    rotation: 0,
    opacity: 100,
    cornerRadius: 0,
    flow: "INLINE",
  };
}

function columns(left: string, rightImageLabel: string): DocumentBlock {
  const leftId = id();
  const rightId = id();
  const leftTextId = id();
  const imageId = id();
  return {
    id: id(),
    type: "COLUMNS",
    locked: false,
    layout: "LEFT_WIDE",
    columns: [left, `[Imagen: ${rightImageLabel}]`],
    cells: [
      {
        id: leftId,
        items: [
          {
            id: leftTextId,
            type: "TEXT",
            locked: false,
            content: left,
            align: "LEFT",
            style: "BODY",
            bold: false,
            italic: false,
            underline: false,
            fontFamily: "SANS",
          },
        ],
      },
      {
        id: rightId,
        items: [
          {
            id: imageId,
            type: "IMAGE",
            locked: false,
            label: rightImageLabel,
            alt: rightImageLabel,
            caption: "",
            fileId: null,
            checksum: null,
            replaceable: true,
            visible: true,
            width: "FULL",
            widthPercent: 100,
            align: "CENTER",
            fit: "CONTAIN",
            aspectRatio: "AUTO",
            focalX: 50,
            focalY: 50,
            rotation: 0,
            opacity: 100,
            cornerRadius: 0,
            flow: "INLINE",
          },
        ],
      },
    ],
  };
}

function gridTable(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  title: string,
): DocumentBlock {
  const tableColumns = columns.map((label) => label || "Dato");
  const tableRows = rows.map((row) => [...row]);
  const cell = (column: number, content: string, style: TableCellStyle = {}) => ({
    id: id(),
    column,
    colSpan: 1,
    rowSpan: 1,
    content,
    style,
  });
  return {
    id: id(),
    type: "TABLE",
    locked: false,
    columns: tableColumns,
    rows: tableRows,
    columnWidths: tableColumns.map((_, index) =>
      index === 0 ? 100 - 20 * (tableColumns.length - 1) : 20,
    ),
    grid: {
      columns: tableColumns.map((_, index) => ({
        id: id(),
        widthPercent: index === 0 ? 100 - 20 * (tableColumns.length - 1) : 20,
      })),
      rows: [
        {
          id: id(),
          section: "HEADER",
          cells: [
            {
              id: id(),
              column: 0,
              colSpan: tableColumns.length,
              rowSpan: 1,
              content: title,
              style: {
                horizontalAlign: "CENTER",
                bold: true,
                color: "#FFFFFF",
                backgroundColor: "#333333",
                paddingMm: 2,
              },
            },
          ],
        },
        {
          id: id(),
          section: "HEADER",
          cells: tableColumns.map((label, column) =>
            cell(column, label, {
              horizontalAlign: "CENTER",
              bold: true,
              backgroundColor: "#f1f5f9",
            }),
          ),
        },
        ...tableRows.map((row, rowIndex) => ({
          id: id(),
          section: rowIndex === tableRows.length - 1 ? ("FOOTER" as const) : ("BODY" as const),
          cells: row.map((value, column) =>
            cell(
              column,
              value,
              column === tableColumns.length - 1 ? { horizontalAlign: "RIGHT" } : {},
            ),
          ),
        })),
      ],
    },
  };
}

const design: DocumentDesign = {
  accentColor: "#e30613",
  textColor: "#171717",
  fontFamily: "INSTRUMENT_SANS",
  pageSize: "LETTER",
  margins: { top: 15, right: 15, bottom: 15, left: 15 },
  headerText: "InterAmerican Car Rental",
  headerRightText: "Cotizacion No. {{quote.number}}",
  footerText: "1a. Calle 5-20, Zona 13 Guatemala, C. A. 01013",
  showPageNumbers: true,
  headerEnabled: true,
  headerLayout: "SPLIT",
  headerAlign: "LEFT",
  headerSpacing: "COMPACT",
  headerImagePlacement: { leftPercent: 2, topPx: 4, widthPercent: 18, heightPx: 54 },
  showDocumentKind: false,
  identityEnabled: false,
  footerEnabled: true,
  footerAlign: "RIGHT",
  footerSpacing: "COMPACT",
  logoFileId: null,
  logoChecksum: null,
  backgroundFileId: null,
  backgroundChecksum: null,
};

export function createReferenceBlueprint(key: ReferenceTemplateKey): DocumentReferenceBlueprint {
  const vehicleDescription =
    "DESCRIPCION DEL VEHICULO\n\n{{vehicle.class}}\n{{vehicle.name}}\n\n{{vehicle.features}}\n\n{{vehicle.fuel}}\n{{vehicle.transmission}}";
  const opening = [
    text("Guatemala, {{quote.date}}"),
    text("Estimado/a\n{{contact.name}}\n{{contact.company}}\nPresente", { bold: true }),
    text(
      "Estimado/a:\nDe la manera mas atenta le presento la cotizacion del servicio detallado a continuacion:",
    ),
  ];
  if (key === "TRANSFER_SEDAN") {
    return {
      name: "Cotizacion · Traslado Sedan",
      title: "Cotizacion de traslado",
      design: structuredClone(design),
      blocks: [
        ...opening,
        columns(vehicleDescription, "Composicion del vehiculo · reemplazable"),
        gridTable(
          ["Campo", "Datos de inicio", "Campo", "Datos de destino"],
          [
            ["Fecha", "{{trip.start.date}}", "Fecha", "{{trip.destination.date}}"],
            ["Hora", "{{trip.start.time}}", "Hora", "{{trip.destination.time}}"],
            ["Direccion", "{{trip.start.address}}", "Direccion", "{{trip.destination.address}}"],
            ["Pasajero", "{{passenger.name}}", "Telefono", "{{passenger.phone}}"],
            ["Pasajeros", "{{passenger.count}}", "Maletas", "{{passenger.luggageCount}}"],
            ["Observaciones", "{{trip.observations}}", "", ""],
            ["TOTAL A PAGAR", "", "", "{{quote.total}}"],
          ],
          "INFORMACION DEL SERVICIO",
        ),
        text(
          "Tarifa incluyen:\n• Vehiculo con capacidad segun cantidad de pasajeros\n• Conductor calificado\n• Cobertura de daños a terceros y gastos medicos",
          { breakBefore: true },
        ),
        text(
          "Terminos y condiciones:\n• El servicio debe solicitarse con anticipacion.\n• Al confirmar se paga la totalidad del servicio.\n• Las tarifas aplican en horario habil.",
        ),
        columns(
          "Atentamente,\n\n{{advisor.name}}\n{{advisor.title}}\n{{advisor.phone}}\n{{advisor.email}}",
          "Firma y sello · reemplazable",
        ),
      ],
    };
  }
  return {
    name: "Cotizacion · Alquiler SUV",
    title: "Cotizacion de alquiler SUV",
    design: structuredClone(design),
    blocks: [
      ...opening,
      columns(
        `${vehicleDescription}\n\nDeducible: {{vehicle.deductible}}`,
        "Composicion SUV · reemplazable",
      ),
      gridTable(
        ["Fechas y horarios", "Dias", "Unidades", "Tarifa", "Subtotal"],
        [
          [
            "{{rental.period}}",
            "{{rental.days}}",
            "{{rental.units}}",
            "{{rental.rate}}",
            "{{rental.subtotal}}",
          ],
          [
            "Cobertura de daños a terceros y gastos medicos",
            "{{rental.days}}",
            "01",
            "{{rental.coverageRate}}",
            "{{rental.coverageSubtotal}}",
          ],
          ["Descuento promocional", "", "", "{{rental.discount}}", "{{rental.discountTotal}}"],
          ["TOTAL A PAGAR", "", "", "", "{{quote.total}}"],
        ],
        "INFORMACION DEL SERVICIO",
      ),
      text(
        "Tarifa incluye:\n• Renta del vehiculo.\n• Cobertura de daños a terceros y gastos medicos.\n• Asistencia en carretera 24/7.\n• Kilometraje ilimitado.\n\nRequisitos del alquiler:\n• DPI/Pasaporte vigente.\n• Licencia de conducir vigente.",
        { breakBefore: true },
      ),
      text(
        "ESPECIFICACIONES\n\n• Un dia de arrendamiento lo constituyen 24 horas.\n• El vehiculo debe ser devuelto con el tanque de combustible como lo recibio.\n• En caso de accidente, comunicarse de inmediato con InterAmerican.",
      ),
      text(
        "COBERTURAS INCLUIDAS\n\nCobertura de Daños por Colision, Perdida Total o Robo\nEs de caracter obligatorio y ofrece cobertura de daños, perdida total o robo del vehiculo.\n\nCobertura de Daños a Terceros y Gastos Medicos\nIncluye gastos medicos de los pasajeros conforme a las condiciones comerciales.",
        { breakBefore: true },
      ),
      columns(
        "NUMERO DE EMERGENCIAS\nAtencion 24hrs\n{{company.emergencyPhone}}\n\n{{advisor.name}}\n{{advisor.title}}\n{{advisor.phone}}\n{{advisor.email}}",
        "Firma y sello · reemplazable",
      ),
      image("Logotipo corporativo · reemplazable"),
    ],
  };
}
