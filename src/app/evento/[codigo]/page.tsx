import { redirect } from "next/navigation";

/** Link curto alternativo: /evento/CODIGO → página de entrada. */
export default async function EventoAlias({ params }: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params;
  redirect(`/entrar/${encodeURIComponent(codigo.toUpperCase())}`);
}
