"use client";
import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/primitives";

/** Campo de texto que confirma o valor após uma pausa na digitação (ou ao pressionar Enter). */
export function DebouncedInput({
  value,
  onCommit,
  delay = 400,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: string; onCommit: (v: string) => void; delay?: number }) {
  const [local, setLocal] = useState(value);
  const commitRef = useRef(onCommit);
  commitRef.current = onCommit;
  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    if (local === value) return;
    const t = setTimeout(() => commitRef.current(local), delay);
    return () => clearTimeout(t);
  }, [local, value, delay]);
  return (
    <Input
      {...props}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          if (local !== value) commitRef.current(local);
        }
        props.onKeyDown?.(e);
      }}
    />
  );
}
