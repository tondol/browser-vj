// File System Access API (WICG) のうち lib.dom に未収録の部分のみ宣言
interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: { description?: string; accept: Record<string, string[]> }[];
  excludeAcceptAllOption?: boolean;
}

interface Window {
  showOpenFilePicker?(
    options?: OpenFilePickerOptions,
  ): Promise<FileSystemFileHandle[]>;
  showDirectoryPicker?(): Promise<FileSystemDirectoryHandle>;
}

interface FileSystemHandle {
  queryPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
  requestPermission?(descriptor: {
    mode: "read" | "readwrite";
  }): Promise<PermissionState>;
}

interface DataTransferItem {
  getAsFileSystemHandle?(): Promise<FileSystemHandle | null>;
}

interface FileSystemDirectoryHandle {
  values(): AsyncIterableIterator<
    FileSystemFileHandle | FileSystemDirectoryHandle
  >;
}
