import { Extension } from '@tiptap/core';
import { uploadFile } from '../../lib/api.js';

// Turns a base64 data URL into a hosted file URL (/api/v1/files/<id>) so the
// stored body stays a lean reference instead of an inline base64 blob. Returns
// the original data URL unchanged on any failure or for non-data URLs, so the
// editor keeps working even if upload is unavailable.
export type ImageUploader = (dataUrl: string) => Promise<string>;

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

export function makeDataUrlUploader(projectId: string): ImageUploader {
  return async (dataUrl) => {
    const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
    if (match === null) {
      return dataUrl;
    }
    const mime = match[1] ?? 'image/png';
    const content_base64 = match[2] ?? '';
    try {
      const uploaded = await uploadFile(projectId, {
        filename: `image.${MIME_EXT[mime] ?? 'bin'}`,
        mime,
        content_base64,
      });
      return uploaded.url;
    } catch {
      return dataUrl;
    }
  };
}

// Carries the active uploader on the editor so the AnnotatableImage node view
// (which only has `editor`) can reach it. insertImageFiles takes the uploader as
// an argument instead, since it only has the ProseMirror view.
export type ImageUploadStorage = { uploader: ImageUploader | null };

// Augment editor.storage so `editor.storage.imageUpload` is typed wherever the
// ImageUploadContext extension is registered (optional: some editors may omit it).
declare module '@tiptap/core' {
  interface Storage {
    imageUpload?: ImageUploadStorage;
  }
}

export const ImageUploadContext = Extension.create<unknown, ImageUploadStorage>({
  name: 'imageUpload',
  addStorage() {
    return { uploader: null };
  },
});
