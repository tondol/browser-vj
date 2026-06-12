export interface LibraryEntry {
  id: number;
  name: string;
  file: File;
}

// ライブラリはセッション内のみ保持する（永続化はしない）。
export class Library {
  private entries: LibraryEntry[] = [];
  private nextId = 1;

  list(): LibraryEntry[] {
    return [...this.entries];
  }

  add(file: File): void {
    this.entries.push({ id: this.nextId++, name: file.name, file });
  }

  remove(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  clear(): void {
    this.entries = [];
  }
}
