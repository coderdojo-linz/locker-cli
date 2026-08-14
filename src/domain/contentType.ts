import path from 'node:path';

/**
 * A guess at what a file is, from its extension.
 *
 * Only a guess, and only ever used as one. The API stores whatever it is told
 * and the browser does the same, so nothing downstream depends on this being
 * right — it decides whether a picture previews in the web interface, not
 * whether the upload works. Everything unrecognised is an octet stream, which is
 * what the API itself falls back to.
 *
 * The list is short on purpose: the extensions a Dojo actually produces, plus
 * the handful of archive and document types a project tends to collect.
 */
const TYPES = new Map<string, string>(
  Object.entries({
    // What the kids make
    '.sb3': 'application/x.scratch.sb3',
    '.sb2': 'application/x.scratch.sb2',
    '.py': 'text/x-python',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.css': 'text/css',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.xml': 'text/xml',
    '.ino': 'text/x-arduino',
    '.cs': 'text/plain',
    '.java': 'text/x-java-source',
    '.c': 'text/x-c',
    '.cpp': 'text/x-c',
    '.h': 'text/x-c',
    '.lua': 'text/x-lua',
    '.sh': 'text/x-shellscript',

    // Pictures and sound
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',

    // Bundles and documents
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }),
);

export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

export const contentTypeFor = (fileName: string): string =>
  TYPES.get(path.extname(fileName).toLowerCase()) ?? DEFAULT_CONTENT_TYPE;
