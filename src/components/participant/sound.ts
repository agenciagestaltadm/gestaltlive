"use client";
/**
 * Efeitos sonoros sintetizados (Web Audio). Só tocam depois que o usuário ativou o som
 * (interação explícita) — nunca reproduzimos áudio automaticamente.
 */
let ctx: AudioContext | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = "sine", gain = 0.08) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start);
  o.stop(a.currentTime + start + dur + 0.05);
}

export function playSound(kind: "open" | "sent" | "correct" | "wrong" | "points" | "fanfare") {
  switch (kind) {
    case "open":
      tone(660, 0, 0.12);
      tone(880, 0.1, 0.15);
      break;
    case "sent":
      tone(520, 0, 0.08, "triangle");
      break;
    case "correct":
      tone(523, 0, 0.12, "triangle");
      tone(659, 0.1, 0.12, "triangle");
      tone(784, 0.2, 0.25, "triangle");
      break;
    case "wrong":
      tone(220, 0, 0.25, "sawtooth", 0.04);
      break;
    case "points":
      tone(988, 0, 0.08, "square", 0.03);
      tone(1318, 0.07, 0.12, "square", 0.03);
      break;
    case "fanfare":
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.12, 0.3, "triangle"));
      break;
  }
}
