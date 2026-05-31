/**
 * RS256 JWT signing for GitHub App authentication.
 *
 * GitHub Apps download `.pem` files in PKCS#1 format
 * (`-----BEGIN RSA PRIVATE KEY-----`). The Web Crypto API in Cloudflare
 * Workers only accepts PKCS#8 (`-----BEGIN PRIVATE KEY-----`) for RSA.
 * The wrapper below converts PKCS#1 DER to PKCS#8 by adding the
 * standard ASN.1 envelope:
 *
 *   SEQUENCE {
 *     INTEGER 0                                 -- version
 *     SEQUENCE { OID rsaEncryption, NULL }      -- algorithm
 *     OCTET STRING { <pkcs1 DER> }              -- private key
 *   }
 *
 * If the user has already converted to PKCS#8 (`-----BEGIN PRIVATE
 * KEY-----`), it's used as-is.
 */

export interface AppJwtClaims {
  /** Numeric App ID OR Client ID (`Iv23li...`). GitHub accepts either. */
  issuer: string;
  /** Seconds backdated for clock skew. Default 60. */
  iatBackdateSec?: number;
  /** TTL in seconds. GitHub max is 600 (10 min). Default 540 (9 min). */
  ttlSec?: number;
}

export async function signAppJwt(
  pemPrivateKey: string,
  claims: AppJwtClaims
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const iatBackdateSec = claims.iatBackdateSec ?? 60;
  const ttlSec = claims.ttlSec ?? 540;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: now - iatBackdateSec,
    exp: now + ttlSec,
    iss: claims.issuer,
  };

  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const key = await importPrivateKey(pemPrivateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(signingInput)
  );
  const sigB64 = base64UrlEncode(new Uint8Array(signature));

  return `${signingInput}.${sigB64}`;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const trimmed = pem.trim();
  const isPkcs1 = trimmed.includes("-----BEGIN RSA PRIVATE KEY-----");

  // Strip PEM markers + whitespace, base64-decode the body.
  const body = trimmed
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  let der = base64Decode(body);

  if (isPkcs1) {
    der = wrapPkcs1AsPkcs8(der);
  }

  // Copy into a fresh ArrayBuffer (TS narrows .buffer to a wider type
  // when the source is a typed array view; importKey wants ArrayBuffer).
  const ab = new ArrayBuffer(der.byteLength);
  new Uint8Array(ab).set(der);
  return crypto.subtle.importKey(
    "pkcs8",
    ab,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64Decode(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** PKCS#1 RSA private key DER → PKCS#8 RSA private key DER. */
function wrapPkcs1AsPkcs8(pkcs1: Uint8Array): Uint8Array {
  // OID 1.2.840.113549.1.1.1 = rsaEncryption
  const oidRsa = new Uint8Array([
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
  ]);
  const algNull = new Uint8Array([0x05, 0x00]);
  const algSeq = sequence(concat(oidRsa, algNull));
  const version = new Uint8Array([0x02, 0x01, 0x00]); // INTEGER 0
  const octetString = octet(pkcs1);
  return sequence(concat(version, algSeq, octetString));
}

function sequence(content: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0x30]), encodeAsn1Length(content.length), content);
}

function octet(content: Uint8Array): Uint8Array {
  return concat(new Uint8Array([0x04]), encodeAsn1Length(content.length), content);
}

function encodeAsn1Length(len: number): Uint8Array {
  if (len < 0x80) return new Uint8Array([len]);
  if (len < 0x100) return new Uint8Array([0x81, len]);
  if (len < 0x10000) return new Uint8Array([0x82, (len >> 8) & 0xff, len & 0xff]);
  if (len < 0x1000000) {
    return new Uint8Array([0x83, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
  }
  throw new Error("ASN.1 length too large");
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
