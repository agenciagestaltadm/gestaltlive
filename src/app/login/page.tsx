"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn } from "lucide-react";
import { loginSchema } from "@shared/schemas";
import { publicFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { GestaltLogo, ProductMark } from "@/components/brand";
import type { z } from "zod";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });
  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await publicFetch("/auth/login", { method: "POST", json: values });
      const back = params.get("voltar");
      router.push(back && back.startsWith("/admin") ? back : "/admin");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível entrar.");
    }
  });
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="E-mail" error={formState.errors.email?.message} htmlFor="email">
        <Input id="email" type="email" autoComplete="username" {...register("email")} aria-invalid={!!formState.errors.email} />
      </Field>
      <Field label="Senha" error={formState.errors.password?.message} htmlFor="password">
        <Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!formState.errors.password} />
      </Field>
      {error && (
        <p className="rounded-xl bg-negative/10 px-3 py-2 text-sm font-bold text-negative" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" loading={formState.isSubmitting}>
        <LogIn /> Entrar
      </Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="dark bg-brand-hero grid min-h-dvh place-items-center p-4 text-white">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <GestaltLogo kind="logo" className="h-20" />
          <ProductMark className="text-2xl" />
          <p className="text-white/70">Acesso de administradores e palestrantes</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-navy-900/80 p-6 shadow-2xl backdrop-blur">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
