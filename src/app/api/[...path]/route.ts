/**
 * API do Gestalt Live como função da Vercel. Todas as rotas /api/* são atendidas pelo mesmo app Hono do
 * servidor próprio (server/app.ts). No servidor próprio (npm run dev/start) esta rota não é usada:
 * o servidor HTTP entrega /api/* direto ao Hono antes do Next.js.
 */
import { getServerlessRuntime } from "@server/serverless";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function handler(req: Request) {
  try {
    const rt = await getServerlessRuntime();
    return await rt.app.fetch(req);
  } catch (err) {
    console.error("falha ao iniciar a API", err);
    return Response.json({ error: { code: "SERVIDOR_INDISPONIVEL", message: "Servidor indisponível. Verifique a configuração do banco de dados." } }, { status: 503 });
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE, handler as OPTIONS, handler as HEAD };
