import type { components } from './schema.js';

/**
 * The shapes the Locker API sends back.
 *
 * Named here, generated in schema.ts. These used to be written out by hand and
 * kept deliberately loose, on the grounds that `npx` runs whatever was published
 * last against whatever a Dojo happens to be running — but loose by hand meant
 * loose in one direction only: a field the CLI read and the API had renamed was
 * a runtime surprise rather than a build error. The document the API publishes
 * is the source now, and the tolerance that mattered is still there: an unknown
 * field is ignored, because nothing here validates a response, it only describes
 * one.
 *
 * Aliases rather than re-exports of `components["schemas"]["…"]` at every call
 * site, so the rest of the CLI reads the same as it always did.
 */

type Schemas = components['schemas'];

export type LockerDetails = Schemas['LockerDetails'];
export type LockerSummary = Schemas['LockerSummary'];
export type LockerCodeReplacement = Schemas['LockerCodeReplacement'];
export type ProjectDetails = Schemas['ProjectDetails'];
export type ProjectFileDetails = Schemas['ProjectFileDetails'];
export type ProjectShareDetails = Schemas['ProjectShareDetails'];
export type SharedLinkDetails = Schemas['SharedLinkDetails'];
export type MentorSharedLinkDetails = Schemas['MentorSharedLinkDetails'];
export type AuthorizedUpload = Schemas['AuthorizedUpload'];
export type AuthorizedUploadFile = Schemas['AuthorizedUploadFile'];
export type UploadFileRequest = Schemas['UploadFileRequest'];
export type ApprovalTicket = Schemas['ApprovalTicket'];
export type UploadPermitDetails = Schemas['UploadPermitDetails'];

/** Everything the desk does, for the commands that carry a key. */
export type CodeBatchDetails = Schemas['CodeBatchDetails'];
export type EventDetails = Schemas['EventDetails'];
export type EventPolicy = Schemas['EventPolicy'];
export type DefaultPolicyDetails = Schemas['DefaultPolicyDetails'];
export type CardDesignDetails = Schemas['CardDesignDetails'];
export type ApiKeyDetails = Schemas['ApiKeyDetails'];
export type CreatedApiKey = Schemas['CreatedApiKey'];
export type MentorDetails = Schemas['MentorDetails'];
export type SettingsDetails = Schemas['SettingsDetails'];
export type GuestInviteDetails = Schemas['GuestInviteDetails'];
export type PendingApproval = Schemas['PendingApproval'];
export type PendingReview = Schemas['PendingReview'];
export type AuthenticatedMentor = Schemas['AuthenticatedMentor'];
export type PaperSize = Schemas['PaperSize'];

/**
 * Why a Dojo would not let this upload start, in the words a client switches on.
 *
 * The one shape still written by hand, because it is not a response: it rides
 * inside the problem body of a 403, beside the sentence a person reads, and a
 * problem's extensions are untyped by construction. The sentence is the
 * server's and is shown as written; this is what decides whether the CLI can do
 * something about it — hold up a QR code, wait for a poster to be scanned — or
 * can only say so and stop.
 */
export interface UploadGateProblem {
  verdict: 'NeedsApproval' | 'NeedsEventCode' | 'WrongNetwork' | string;
  mode: string;
  eventId: string | null;
  eventName: string | null;
  approvalMinutes: number;
}
