/**
 * The shapes the Locker API sends back.
 *
 * Written out rather than generated, and deliberately tolerant: `npx` runs
 * whatever version was published last against whatever version a Dojo happens to
 * be running, so an unknown field is ignored rather than treated as a problem.
 * Only fields the CLI actually reads are declared.
 */

export interface ProjectFileDetails {
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** Set for a pasted link rather than an uploaded file; such a file has no bytes. */
  externalUrl: string | null;
  uploadedAt: string;
  /** The folder the file sat in, kept on the row rather than in storage. */
  relativePath: string | null;
  shareCode: string | null;
}

export interface ProjectDetails {
  id: string;
  name: string;
  createdAt: string;
  files: ProjectFileDetails[];
  shareCode: string | null;
}

export interface LockerDetails {
  id: string;
  code: string;
  name: string;
  ownerName: string | null;
  status: string;
  usedBytes: number;
  storageLimitBytes: number;
  lastActivityAt: string;
  projects: ProjectDetails[];
}

/** One file's upload target: where to PUT it, and the headers storage insists on. */
export interface AuthorizedUploadFile {
  name: string;
  url: string;
  headers: Record<string, string>;
}

export interface AuthorizedUpload {
  ticket: string;
  expiresAt: string;
  files: AuthorizedUploadFile[];
}

export interface ProjectShareDetails {
  code: string;
  createdAt: string;
  expiresAt: string;
}

export interface SharedLinkDetails {
  code: string;
  projectId: string;
  projectName: string;
  fileId: string | null;
  fileName: string | null;
  createdAt: string;
  expiresAt: string;
}

/** What the CLI sends when asking for upload URLs. */
export interface UploadFileRequest {
  name: string;
  size: number;
  contentType: string;
}
