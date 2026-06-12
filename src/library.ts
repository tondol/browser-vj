export interface LibraryEntry {
  id: number;
  name: string;
  source: FileSystemFileHandle | File;
  persisted: boolean;
}

export const supportsFsAccess = "showOpenFilePicker" in window;

const DB_NAME = "browser-vj";
const STORE = "library";

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
  };
  return request(open);
}

export class Library {
  private memoryEntries: LibraryEntry[] = [];
  private nextMemoryId = -1;

  private constructor(private db: IDBDatabase | null) {}

  static async open(): Promise<Library> {
    try {
      return new Library(await openDb());
    } catch {
      return new Library(null);
    }
  }

  async list(): Promise<LibraryEntry[]> {
    if (!this.db) return [...this.memoryEntries];
    const tx = this.db.transaction(STORE, "readonly");
    const rows = await request(
      tx.objectStore(STORE).getAll() as IDBRequest<
        { id: number; name: string; handle: FileSystemFileHandle }[]
      >,
    );
    const persisted = rows.map((row) => ({
      id: row.id,
      name: row.name,
      source: row.handle,
      persisted: true,
    }));
    return [...persisted, ...this.memoryEntries];
  }

  async add(source: FileSystemFileHandle | File): Promise<void> {
    if (this.db && !(source instanceof File)) {
      const tx = this.db.transaction(STORE, "readwrite");
      await request(tx.objectStore(STORE).add({ name: source.name, handle: source }));
      return;
    }
    this.memoryEntries.push({
      id: this.nextMemoryId--,
      name: source.name,
      source,
      persisted: false,
    });
  }

  async clear(): Promise<void> {
    this.memoryEntries = [];
    if (!this.db) return;
    const tx = this.db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).clear());
  }

  async remove(id: number): Promise<void> {
    if (id < 0) {
      this.memoryEntries = this.memoryEntries.filter((e) => e.id !== id);
      return;
    }
    if (!this.db) return;
    const tx = this.db.transaction(STORE, "readwrite");
    await request(tx.objectStore(STORE).delete(id));
  }

  async getFile(entry: LibraryEntry): Promise<File | null> {
    if (entry.source instanceof File) return entry.source;
    const handle = entry.source;
    try {
      let permission = await handle.queryPermission?.({ mode: "read" });
      if (permission !== "granted") {
        permission = await handle.requestPermission?.({ mode: "read" });
      }
      if (permission !== "granted") return null;
      return await handle.getFile();
    } catch {
      return null;
    }
  }

  // 権限プロンプトを出さずに取得できる File だけ返す（サムネ生成用）。
  // 未許可のハンドルは null（呼び出し側はプレースホルダにフォールバックする）。
  async getFileIfReady(entry: LibraryEntry): Promise<File | null> {
    if (entry.source instanceof File) return entry.source;
    const handle = entry.source;
    try {
      const permission = await handle.queryPermission?.({ mode: "read" });
      if (permission !== "granted") return null;
      return await handle.getFile();
    } catch {
      return null;
    }
  }
}
