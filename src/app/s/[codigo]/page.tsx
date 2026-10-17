"use client";
import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

export default function SessionIndex() {
  const params = useParams<{ codigo: string }>();
  const router = useRouter();
  useEffect(() => {
    router.replace(`/s/${String(params.codigo).toUpperCase()}/ao-vivo`);
  }, [params.codigo, router]);
  return null;
}
