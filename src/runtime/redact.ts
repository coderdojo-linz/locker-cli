/**
 * Taking the secrets back out of anything about to be written down.
 *
 * Two kinds travel through this CLI. The locker code is the credential itself,
 * and it appears in the URL of nearly every request because that is where the
 * API takes it. The other is the signature on a storage upload or download URL,
 * which is a bearer token for one file for a few minutes.
 *
 * Both are removed from diagnostics, from verbose output, and from error text.
 * A diagnostic file exists to be attached to a bug report, which means it exists
 * to be sent to somebody else.
 */

const MASK = '[redacted]';

/**
 * Query parameters that carry a signature on a storage URL.
 *
 * Azure SAS uses `sig`, and its companions describe the grant. S3 presigned URLs
 * use `X-Amz-Signature` and friends. The local backend puts a signed token in
 * the path instead, which is why <see cref="redact"/> also takes the route.
 */
const SIGNED_PARAMETERS = [
  'sig',
  'se',
  'st',
  'sp',
  'sv',
  'sr',
  'skoid',
  'sktid',
  'X-Amz-Signature',
  'X-Amz-Credential',
  'X-Amz-Security-Token',
];

const signedParameterPattern = new RegExp(
  `([?&](?:${SIGNED_PARAMETERS.join('|')})=)[^&\\s"']+`,
  'gi',
);

/** The local backend's upload route ends in a signed token that is not a query parameter. */
const localUploadTokenPattern = /(\/api\/projects\/uploads\/)[^\s"'/?]+/gi;

export interface RedactionSecrets {
  /** The locker code in play, if there is one. Matched case-insensitively. */
  code?: string | null;
}

export function redact(value: string, secrets: RedactionSecrets = {}): string {
  let result = value
    .replace(signedParameterPattern, `$1${MASK}`)
    .replace(localUploadTokenPattern, `$1${MASK}`);

  const code = secrets.code?.trim();
  // Guarded on length: a one or two character "code" would match everywhere and
  // turn the whole log into mask characters.
  if (code && code.length >= 4) {
    result = result.replaceAll(new RegExp(escapeForRegExp(code), 'gi'), MASK);
  }
  return result;
}

/** Applied to whole objects on their way into a diagnostic file. */
export function redactDeep(value: unknown, secrets: RedactionSecrets = {}): unknown {
  if (typeof value === 'string') return redact(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, secrets));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        isSecretKey(key) ? MASK : redactDeep(item, secrets),
      ]),
    );
  }
  return value;
}

/** Headers and fields whose value is a secret whatever it happens to contain. */
const isSecretKey = (key: string): boolean =>
  /^(authorization|cookie|set-cookie|x-api-key|ticket|token|code)$/i.test(key);

const escapeForRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
