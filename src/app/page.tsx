"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, QrCode, Trophy, ThumbsUp, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/primitives";
import { GestaltLogo, ProductMark } from "@/components/brand";

export default function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const go = (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length >= 4) router.push(`/entrar/${c}`);
  };
  return (
    <div className="dark bg-brand-hero min-h-dvh text-white">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <ProductMark />
        <Link href="/login" className="text-sm font-bold text-white/70 hover:text-white">
          Área do organizador
        </Link>
      </header>
      <main className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-8 lg:grid-cols-2 lg:pt-20">
        <section>
          <GestaltLogo kind="logo" className="mb-8 h-16" />
          <h1 className="font-display text-4xl leading-tight sm:text-5xl">
            Transforme a palestra em uma <span className="text-gradient-brand">experiência ao vivo</span>.
          </h1>
          <p className="mt-4 max-w-lg text-lg text-white/70">Perguntas em tempo real, ranking gamificado, prêmios para o Top 3 e o termômetro de satisfação do público.</p>
          <ul className="mt-8 grid max-w-lg grid-cols-2 gap-3 text-sm font-bold text-white/80">
            <li className="flex items-center gap-2"><QrCode className="size-5 text-brand" /> Entrada por QR Code</li>
            <li className="flex items-center gap-2"><BarChart3 className="size-5 text-brand" /> Gráficos ao vivo</li>
            <li className="flex items-center gap-2"><Trophy className="size-5 text-gold" /> Ranking e pódio</li>
            <li className="flex items-center gap-2"><ThumbsUp className="size-5 text-positive" /> Satisfação contínua</li>
          </ul>
        </section>
        <section className="rounded-3xl border border-white/10 bg-navy-900/70 p-6 shadow-2xl backdrop-blur sm:p-8">
          <h2 className="text-xl font-black">Vai participar de um treinamento?</h2>
          <p className="mt-1 text-white/70">Digite o código exibido no telão ou leia o QR Code.</p>
          <form onSubmit={go} className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Ex.: K7Q2XM"
              maxLength={10}
              autoCapitalize="characters"
              autoComplete="off"
              aria-label="Código da sessão"
              className="h-14 text-center text-2xl font-black tracking-[0.3em] uppercase sm:text-left"
            />
            <Button type="submit" size="xl" disabled={code.trim().length < 4}>
              Entrar <ArrowRight />
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
