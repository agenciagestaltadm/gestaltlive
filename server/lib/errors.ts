/** Erros de domínio convertidos em respostas HTTP padronizadas: { error: { code, message, details? } }. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown, code = "REQUISICAO_INVALIDA") => new AppError(400, code, message, details);
export const unauthorized = (message = "Autenticação necessária.") => new AppError(401, "NAO_AUTENTICADO", message);
export const forbidden = (message = "Você não tem permissão para esta ação.") => new AppError(403, "SEM_PERMISSAO", message);
export const notFound = (message = "Recurso não encontrado.") => new AppError(404, "NAO_ENCONTRADO", message);
export const conflict = (message: string, code = "CONFLITO", details?: unknown) => new AppError(409, code, message, details);
export const tooMany = (message = "Muitas requisições. Aguarde alguns instantes.") => new AppError(429, "LIMITE_EXCEDIDO", message);
