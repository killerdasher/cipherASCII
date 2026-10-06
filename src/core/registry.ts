/**
 * Generic registry used by every pluggable subsystem (mapping strategies,
 * dither algorithms, charsets, exporters, generators, commands...).
 *
 * Registries are the extension points of the application: a future plugin only
 * needs to call `register()` to become available to the UI.
 */

export interface Identified {
  id: string;
}

export class Registry<T extends Identified> {
  private items = new Map<string, T>();
  private order: string[] = [];

  constructor(
    private readonly kind: string,
    private readonly options: { allowOverride?: boolean } = {},
  ) {}

  register(item: T): void {
    if (this.items.has(item.id) && !this.options.allowOverride) {
      throw new Error(`${this.kind} '${item.id}' is already registered`);
    }
    if (!this.items.has(item.id)) this.order.push(item.id);
    this.items.set(item.id, item);
  }

  registerAll(items: readonly T[]): void {
    for (const item of items) this.register(item);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  /** Like `get`, but throws a descriptive error when missing. */
  require(id: string): T {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Unknown ${this.kind}: '${id}'. Known: ${this.order.join(', ')}`);
    }
    return item;
  }

  ids(): string[] {
    return [...this.order];
  }

  list(): T[] {
    return this.order.map((id) => this.items.get(id)!);
  }

  get size(): number {
    return this.items.size;
  }
}
