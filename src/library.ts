export interface LibraryEntry {
  id: number;
  name: string;
  path: string;
  file: File;
}

// ライブラリはセッション内のみ保持する（永続化はしない）。
// 表示順はフォルダ＋ファイル名のフルパスで自然順ソートする。
export class Library {
  private entries: LibraryEntry[] = [];
  private nextId = 1;

  list(): LibraryEntry[] {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
    return [...this.entries].sort((a, b) => collator.compare(a.path, b.path));
  }

  // path はソート用のフルパス。フォルダ情報が無ければファイル名を渡す。
  add(file: File, path: string): void {
    this.entries.push({ id: this.nextId++, name: file.name, path, file });
  }

  remove(id: number): void {
    this.entries = this.entries.filter((e) => e.id !== id);
  }

  clear(): void {
    this.entries = [];
  }
}
