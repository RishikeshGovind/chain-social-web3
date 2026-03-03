import type { ChainSocialState, StateStore } from "./types";

type FailoverOptions = {
  cooldownMs?: number;
  warnPrefix?: string;
};

export class FailoverStateStore implements StateStore {
  private openedUntilMs = 0;
  private warnedInOpenWindow = false;
  private readonly cooldownMs: number;
  private readonly warnPrefix: string;

  constructor(
    private readonly primary: StateStore,
    private readonly fallback: StateStore,
    options?: FailoverOptions
  ) {
    this.cooldownMs = options?.cooldownMs ?? 30_000;
    this.warnPrefix = options?.warnPrefix ?? "[StateStore]";
  }

  private get isOpen() {
    return Date.now() < this.openedUntilMs;
  }

  isPrimaryAvailable() {
    return !this.isOpen;
  }

  private openCircuit(reason: unknown) {
    this.openedUntilMs = Date.now() + this.cooldownMs;
    this.warnedInOpenWindow = false;
    const message = reason instanceof Error ? reason.message : String(reason);
    console.warn(`${this.warnPrefix} Primary backend failed. Falling back for ${this.cooldownMs}ms.`, message);
  }

  private warnOpenWindowOnce() {
    if (this.warnedInOpenWindow) return;
    this.warnedInOpenWindow = true;
    console.warn(`${this.warnPrefix} Circuit open, using fallback backend.`);
  }

  async read(): Promise<ChainSocialState | null> {
    if (this.isOpen) {
      this.warnOpenWindowOnce();
      return this.fallback.read();
    }

    try {
      return await this.primary.read();
    } catch (error) {
      this.openCircuit(error);
      return this.fallback.read();
    }
  }

  async write(state: ChainSocialState): Promise<void> {
    if (this.isOpen) {
      this.warnOpenWindowOnce();
      await this.fallback.write(state);
      return;
    }

    try {
      await this.primary.write(state);
      await this.fallback.write(state);
    } catch (error) {
      this.openCircuit(error);
      await this.fallback.write(state);
    }
  }
}
