"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutTemplate, Lock } from "lucide-react";
import { PageHeader } from "@/components/admin/admin-shell";
import { useAdmin } from "@/components/admin/admin-context";
import { EventForm } from "@/components/admin/event-form";
import { TemplateEventDialog } from "@/components/admin/template-event-dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/primitives";

export default function NewEventPage() {
  const { can } = useAdmin();
  const router = useRouter();
  const [tplOpen, setTplOpen] = useState(false);

  if (!can("event.write")) {
    return (
      <div>
        <PageHeader title="Novo evento" back={{ href: "/admin/eventos", label: "Eventos" }} />
        <EmptyState icon={<Lock />} title="Sem permissão" description="Seu perfil não permite criar eventos nesta organização." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Novo evento"
        description="Depois de criar, cadastre as perguntas, os prêmios e as sessões (turmas)."
        back={{ href: "/admin/eventos", label: "Eventos" }}
        actions={
          <Button variant="outline" onClick={() => setTplOpen(true)}>
            <LayoutTemplate /> Usar um template
          </Button>
        }
      />
      <EventForm onSaved={(ev) => router.push(`/admin/eventos/${ev.id}`)} />
      <TemplateEventDialog open={tplOpen} onOpenChange={setTplOpen} />
    </div>
  );
}
