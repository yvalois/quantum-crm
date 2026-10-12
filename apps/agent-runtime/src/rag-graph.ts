import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";

export const catalogKindSchema = z.enum(["individual", "corporativo"]);
export type CatalogKind = z.infer<typeof catalogKindSchema>;

const sourceSchema = z.object({
  id: z.string().min(1).max(128),
  catalog: catalogKindSchema,
  page: z.number().int().positive().max(1000),
  text: z.string().min(1).max(4000),
  revision: z.string().min(1).max(128),
});

export type RagSource = z.infer<typeof sourceSchema>;

export interface RagGateway {
  search(input: {
    readonly catalog: CatalogKind;
    readonly question: string;
    readonly limit: number;
  }): Promise<readonly RagSource[]>;
  answer(input: {
    readonly catalog: CatalogKind;
    readonly question: string;
    readonly sources: readonly RagSource[];
  }): Promise<{ readonly text: string; readonly sourceIds: readonly string[] }>;
}

const ragState = new StateSchema({
  question: z.string(),
  catalog: catalogKindSchema,
  sources: z.array(sourceSchema).optional(),
  answer: z.string().optional(),
  citedSourceIds: z.array(z.string()).optional(),
});

export interface RagResult {
  readonly answer: string;
  readonly sources: readonly Pick<RagSource, "id" | "catalog" | "page" | "revision">[];
  readonly grounded: boolean;
}

const noEvidenceAnswer =
  "No encontré información suficiente en el catálogo seleccionado para responder con seguridad.";

export function createRagGraph(gateway: RagGateway) {
  return new StateGraph(ragState)
    .addNode("retrieve", async (state) => {
      const raw = await gateway.search({
        catalog: state.catalog,
        question: state.question,
        limit: 8,
      });
      const sources = z.array(sourceSchema).max(8).parse(raw);
      if (sources.some((source) => source.catalog !== state.catalog)) {
        throw new Error("Catalog search returned a source from another catalog");
      }
      return { sources };
    })
    .addNode("compose", async (state) => {
      const sources = state.sources ?? [];
      if (sources.length === 0) {
        return { answer: noEvidenceAnswer, citedSourceIds: [] };
      }
      const generated = await gateway.answer({
        catalog: state.catalog,
        question: state.question,
        sources,
      });
      const answer = z.string().trim().min(1).max(4000).parse(generated.text);
      const citedSourceIds = z.array(z.string()).max(8).parse(generated.sourceIds);
      const allowed = new Set(sources.map((source) => source.id));
      if (citedSourceIds.length === 0 || citedSourceIds.some((id) => !allowed.has(id))) {
        return { answer: noEvidenceAnswer, citedSourceIds: [] };
      }
      return { answer, citedSourceIds: [...new Set(citedSourceIds)] };
    })
    .addEdge(START, "retrieve")
    .addEdge("retrieve", "compose")
    .addEdge("compose", END)
    .compile();
}

export async function askCatalog(
  gateway: RagGateway,
  input: { readonly catalog: CatalogKind; readonly question: string },
): Promise<RagResult> {
  const catalog = catalogKindSchema.parse(input.catalog);
  const question = z.string().trim().min(3).max(2000).parse(input.question);
  const result = await createRagGraph(gateway).invoke({ catalog, question });
  const cited = new Set(result.citedSourceIds ?? []);
  const sources = (result.sources ?? [])
    .filter((source) => cited.has(source.id))
    .map(({ id, catalog: sourceCatalog, page, revision }) => ({
      id,
      catalog: sourceCatalog,
      page,
      revision,
    }));
  return {
    answer: result.answer ?? noEvidenceAnswer,
    sources,
    grounded: sources.length > 0,
  };
}
