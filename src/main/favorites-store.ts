/**
 * 收藏夹：只存 assetId 列表，独立文件（userData/favorites.json）。
 *
 * 和作品库索引分开的原因：收藏是"我的标记"，即使索引重建（从文件恢复）也不会丢，
 * 而且文件很小，读写不需要碰整份索引。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export class FavoritesStore {
  readonly #file: string;
  #ids: Set<string>;

  constructor(options: { readonly indexDir: string; readonly file?: string }) {
    this.#file = options.file ?? path.join(options.indexDir, "favorites.json");
    this.#ids = new Set(this.#load());
  }

  #load(): string[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#file, "utf8"));
      const list = (parsed as { favorites?: unknown }).favorites;
      if (!Array.isArray(list)) return [];
      return list.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128);
    } catch {
      return [];
    }
  }

  list(): readonly string[] {
    return [...this.#ids];
  }

  has(id: string): boolean {
    return this.#ids.has(id);
  }

  toggle(id: string): { readonly favorite: boolean } {
    if (this.#ids.has(id)) this.#ids.delete(id);
    else this.#ids.add(id);
    this.#persist();
    return { favorite: this.#ids.has(id) };
  }

  /** 作品被删掉时同步清理，避免收藏里堆着不存在的 id。 */
  forget(id: string): void {
    if (!this.#ids.delete(id)) return;
    this.#persist();
  }

  replaceAll(ids: readonly string[]): void {
    this.#ids = new Set(ids);
    this.#persist();
  }

  #persist(): void {
    try {
      mkdirSync(path.dirname(this.#file), { recursive: true });
      writeFileSync(this.#file, JSON.stringify({ favorites: [...this.#ids] }, null, 2), "utf8");
    } catch (error) {
      console.warn("[image-agent] 收藏夹写盘失败：", (error as Error).message);
    }
  }

  get file(): string {
    return this.#file;
  }

  exists(): boolean {
    return existsSync(this.#file);
  }
}
