/**
 * Rate limiting (token bucket) em memória, por chave (IP, participante, usuário).
 * Em múltiplas instâncias, complemente no proxy/ingress (ver docs/DEPLOY.md).
 */
import { tooMany } from "./errors";

interface Bucket {
  tokens: number;
  updated: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();
  private sweep: NodeJS.Timeout;

  constructor(
    private capacity: number,
    private refillPerSec: number,
  ) {
    this.sweep = setInterval(() => this.cleanup(), 60_000);
    this.sweep.unref();
  }

  take(key: string, cost = 1): boolean {
    const now = Date.now();
    const b = this.buckets.get(key) ?? { tokens: this.capacity, updated: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.updated) / 1000) * this.refillPerSec);
    b.updated = now;
    this.buckets.set(key, b);
    if (b.tokens < cost) return false;
    b.tokens -= cost;
    return true;
  }

  enforce(key: string, cost = 1) {
    if (!this.take(key, cost)) throw tooMany();
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, b] of this.buckets) if (now - b.updated > 10 * 60_000) this.buckets.delete(k);
  }

  close() {
    clearInterval(this.sweep);
  }
}

export interface RateLimits {
  login: RateLimiter;
  join: RateLimiter;
  lookup: RateLimiter;
  answer: RateLimiter;
  satisfaction: RateLimiter;
  participant: RateLimiter;
  admin: RateLimiter;
}

/**
 * Limites padrão. Em eventos presenciais muitos participantes compartilham o mesmo IP (Wi-Fi do local),
 * por isso cadastro e consulta por IP são generosos e os limites finos são por participante.
 */
export function createRateLimits(multiplier = 1): RateLimits {
  const m = (n: number) => n * multiplier;
  return {
    login: new RateLimiter(m(10), m(10) / 60),
    join: new RateLimiter(m(600), m(600) / 60),
    lookup: new RateLimiter(m(120), m(120) / 60),
    answer: new RateLimiter(m(10), m(2)),
    satisfaction: new RateLimiter(m(10), m(1)),
    participant: new RateLimiter(m(120), m(30)),
    admin: new RateLimiter(m(600), m(100)),
  };
}

export function closeRateLimits(r: RateLimits) {
  Object.values(r).forEach((l) => l.close());
}
