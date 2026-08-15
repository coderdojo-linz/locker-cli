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
  /**
   * Where this stands with the mentors at a Dojo that asks them to look:
   * `NotRequired` everywhere else. Absent from an older server, which is why
   * every reader treats a missing value as `NotRequired`.
   */
  reviewState?: string;
  reviewNote?: string | null;
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

/**
 * Why a Dojo would not let this upload start, in the words a client switches on.
 *
 * Rides on the 403 the authorize step answers with, beside the sentence a person
 * reads. The sentence is the server's and is shown as written; this is what
 * decides whether the CLI can do something about it — hold up a QR code, wait
 * for a poster to be scanned — or can only say so and stop.
 */
export interface UploadGateProblem {
  verdict: 'NeedsApproval' | 'NeedsEventCode' | 'WrongNetwork' | string;
  mode: string;
  eventId: string | null;
  eventName: string | null;
  approvalMinutes: number;
}

/** A child's request for a mentor to vouch for what they are saving. */
export interface ApprovalTicket {
  code: string;
  status: 'Pending' | 'Approved' | 'Denied' | 'Expired' | string;
  /** The whole address, which is what goes inside the QR code. */
  approveUrl: string;
  expiresAt: string;
  decidedByName: string | null;
  permitExpiresAt: string | null;
}

/** What a locker is currently allowed, after a mentor or a scanned poster said so. */
export interface UploadPermitDetails {
  expiresAt: string;
  singleUse: boolean;
  source: string;
}
