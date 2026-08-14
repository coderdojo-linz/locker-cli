import { CliError, Exit } from './exit.js';
import { explainStatus, transportError, type NotFoundMeaning } from './apiErrors.js';
import type { Diagnostics } from './diagnostics.js';
import type { Reporter } from './reporter.js';

/**
 * Everything that speaks to the Locker.
 *
 * This makes the requests and records them; what a failing status *means* is
 * decided in apiErrors.ts, and nothing else in the CLI is allowed to interpret
 * one. Keeping the two apart is what stops a second opinion about `404`
 * appearing in a command somewhere.
 */

export interface RequestOptions {
  method?: string;
  body?: unknown;
  notFound?: NotFoundMeaning;
  accept?: string;
  /** Hands back the raw response instead of parsed JSON, for file downloads. */
  raw?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export class ApiClient {
  constructor(
    readonly origin: string,
    private readonly language: string,
    private readonly reporter: Reporter,
    private readonly diagnostics: Diagnostics,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Absolute for cloud storage, relative to the API for the local backend. */
  resolveUrl(url: string): string {
    return new URL(url, this.origin).toString();
  }

  /**
   * Builds a request URL and refuses one that has left the chosen host.
   *
   * A path is supposed to resolve against the origin and stay there. Two things
   * break that. A caller of `raw` can pass an absolute URL and point the locker
   * code at somebody else's server, which is worth refusing outright. And Git
   * Bash on Windows rewrites a leading-slash argument into a Windows path
   * before Node ever sees it — `/api/lockers/x` arrives as
   * `C:/Program Files/Git/api/lockers/x` — which without this check fails much
   * later as an unreachable host called "null".
   */
  private buildUrl(path: string): string {
    let url: URL;
    try {
      url = new URL(path, this.origin);
    } catch (cause) {
      throw new CliError(`"${path}" is not a path this CLI can request.`, {
        kind: 'usage',
        exitCode: Exit.Usage,
        recovery: 'locker raw GET api/lockers/{code}',
        cause,
      });
    }

    if (url.origin !== this.origin) {
      // Anything that did not come out as http or https was never a path. Git
      // Bash rewrites a leading slash into a Windows path, and "C:/..." then
      // parses as a URL whose *scheme* is "c" — so the check is on the protocol
      // rather than on the argument, whose leading slash is long gone by now.
      const mangledByShell = url.protocol !== 'http:' && url.protocol !== 'https:';
      throw new CliError(
        mangledByShell
          ? `The shell rewrote that path as "${path}" before the CLI saw it.`
          : `"${path}" points at ${url.origin} rather than ${this.origin}.`,
        {
          kind: 'usage',
          exitCode: Exit.Usage,
          recovery: mangledByShell
            ? 'locker raw GET api/lockers/{code}   (no leading slash)'
            : 'locker raw GET api/lockers/{code}',
        },
      );
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.send(path, options);
    if (options.raw) return response as unknown as T;
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (text.trim().length === 0) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new CliError(`The Locker sent a reply this version cannot read.`, {
        kind: 'server',
        exitCode: Exit.Failure,
        recovery: 'npx @coderdojo-linz/locker@latest --version',
        cause,
      });
    }
  }

  /** Used for downloads, where the body is bytes and the status still matters. */
  async requestRaw(path: string, options: RequestOptions = {}): Promise<Response> {
    return this.send(path, { ...options, raw: true });
  }

  /**
   * Sends bytes to wherever the authorize step said to send them.
   *
   * Not routed through <see cref="send"/>: the target is storage, not the API,
   * it takes headers the API chose rather than ours, and a failure there wants
   * saying differently from a failure at the Locker.
   */
  async putBytes(
    url: string,
    body: Uint8Array,
    headers: Record<string, string>,
    signal?: AbortSignal,
  ): Promise<void> {
    const target = this.resolveUrl(url);
    this.diagnostics.record(`PUT ${target} (${body.byteLength} bytes)`);

    let response: Response;
    try {
      response = await fetch(target, {
        method: 'PUT',
        body,
        headers,
        signal: signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw transportError(target, cause);
    }

    if (response.ok) return;

    const detail = await safeText(response);
    this.diagnostics.record(`PUT ${target} -> ${response.status}`, detail);
    throw new CliError(
      `Storage refused a file (HTTP ${response.status}).`,
      {
        kind: response.status === 413 ? 'quota-exceeded' : 'server',
        exitCode: response.status === 413 ? Exit.Throttled : Exit.Failure,
        recovery: 'locker upload --dry-run   (to check the sizes first)',
        detail,
      },
    );
  }

  private async send(path: string, options: RequestOptions): Promise<Response> {
    const url = this.buildUrl(path);
    const method = options.method ?? 'GET';
    const headers: Record<string, string> = {
      // The API words its own refusals, and answers in the language asked for.
      // Passing this through is what lets a German-speaking child read them.
      'Accept-Language': this.language,
      Accept: options.accept ?? 'application/json',
      'User-Agent': 'coderdojo-locker-cli',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    this.reporter.debug(2, `${method} ${url}`);
    this.diagnostics.record(`${method} ${url}`, options.body);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: options.signal ?? AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw transportError(url, cause);
    }

    this.reporter.debug(2, `${response.status} ${method} ${url}`);
    if (response.ok) return response;

    const body = await safeText(response);
    this.diagnostics.record(`${response.status} ${method} ${url}`, body);
    throw explainStatus(response.status, body, options.notFound);
  }
}

/** A body that cannot be read is not worth failing over; the status still says enough. */
const safeText = async (response: Response): Promise<string> => {
  try {
    return await response.text();
  } catch {
    return '';
  }
};
