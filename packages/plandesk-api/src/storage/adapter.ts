export type StoragePutInput = {
  projectId: string;
  bytes: Buffer;
  filename: string;
  mime: string;
};

export type StoragePutResult = {
  id: string;
  url: string;
};

export type StorageResolveResult =
  | { bytes: Buffer; mime: string; filename: string }
  | { redirectUrl: string };

export type StorageAdapter = {
  put(input: StoragePutInput): Promise<StoragePutResult>;
  resolve(id: string): Promise<StorageResolveResult | null>;
};

export function fileUrl(id: string): string {
  return `/api/v1/files/${id}`;
}
