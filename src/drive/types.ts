export type ResourceKind = 'pdf' | 'video' | 'image' | 'audio' | 'text' | 'link' | 'note' | 'other';

export type ResourceDraft = {
  title: string;
  kind: ResourceKind;
  source: string;
  topicId: string | null;
  tags: string[];
  relatedTopicIds?: string[];
  url?: string;
  note?: string;
  sourcePath?: string;
  needsReview?: boolean;
};

export type Resource = ResourceDraft & {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  version: string;
  modifiedTime: string;
  webViewLink?: string;
  webContentLink?: string;
  md5Checksum?: string;
  importKey?: string;
};

export type DriveAccount = {
  id: string;
  name: string;
  email?: string;
  storage: { limit?: number; usage: number };
};

export type DriveRevision = {
  id: string;
  modifiedTime: string;
  originalFilename?: string;
  keepForever?: boolean;
  size?: string;
};

export type UploadProgress = (uploaded: number, total: number) => void;
export type MediaSource = { url: string; httpHeaders: Record<string, string> };

export function externalUrl(input: string): string | undefined {
  try {
    const url = new URL(input);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href;
  } catch {
    return undefined;
  }
  return undefined;
}
