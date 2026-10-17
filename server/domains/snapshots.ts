/** Cache de snapshots de versões de perguntas (imutáveis — seguros para cache em memória). */
import { eq } from "drizzle-orm";
import type { Tx } from "../db/client";
import { questionVersions } from "../db/schema";
import type { QuestionSnapshot } from "./questions";

const cache = new Map<string, QuestionSnapshot>();

export async function getSnapshot(tx: Tx, versionId: string): Promise<QuestionSnapshot> {
  const hit = cache.get(versionId);
  if (hit) return hit;
  const [v] = await tx.select().from(questionVersions).where(eq(questionVersions.id, versionId));
  if (!v) throw new Error(`Versão de pergunta não encontrada: ${versionId}`);
  const snap = v.snapshot as QuestionSnapshot;
  if (cache.size > 5000) cache.clear();
  cache.set(versionId, snap);
  return snap;
}
