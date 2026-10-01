/**
 * Discovery IR: a language-neutral description of API operations recovered
 * from source code by static analysis (and optionally AI gap resolution).
 *
 * The IR is intentionally richer than NormalizedRequest (which models observed
 * traffic samples): every schema, parameter and response carries a confidence
 * level and, when relevant, the source location it was recovered from. The
 * discovery builder never invents shapes on its own — gaps must be reported
 * through `gaps` instead of being silently filled.
 */

export type Confidence = "high" | "medium" | "low";

/** Machine-readable gap identifiers that drive the completeness gate. */
export type GapCode =
  | "path-dynamic"
  | "path-param-untyped"
  | "query-unknown"
  | "header-unknown"
  | "body-unknown"
  | "body-schema-unknown"
  | "response-unknown"
  | "response-schema-unknown"
  | "auth-unknown"
  | "sse-events-unknown";

export interface SourceLocation {
  /** Repository-relative file path using forward slashes. */
  readonly file: string;
  /** 1-based line of the route registration. */
  readonly line?: number;
  /** Handler symbol or function description, e.g. "createUser". */
  readonly symbol?: string;
}

/** A JSON Schema (draft 2020-12 subset accepted by OpenAPI 3.2). */
export type JsonSchema = Record<string, unknown>;

export interface DiscoveredParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
  confidence: Confidence;
}

export interface DiscoveredMediaType {
  mediaType: string;
  /** Request/response schema. Mutually exclusive with `itemSchema`. */
  schema?: JsonSchema;
  /**
   * Schema of one streamed item; used exclusively for
   * `text/event-stream` responses (SSE), matching the canonical Powerduck
   * protocol extension shape.
   */
  itemSchema?: JsonSchema;
  confidence?: Confidence;
}

export interface DiscoveredRequestBody {
  required?: boolean;
  content: DiscoveredMediaType[];
  confidence: Confidence;
}

export interface DiscoveredResponse {
  /** "200", "2XX", "default", ... */
  statusCode: string;
  description: string;
  content?: DiscoveredMediaType[];
  headers?: Record<string, JsonSchema>;
  confidence: Confidence;
}

export interface DiscoveredOperation {
  method: string;
  /** Full path template with `{name}` placeholders, including mount prefixes. */
  path: string;
  summary?: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: DiscoveredParameter[];
  requestBody?: DiscoveredRequestBody;
  responses: DiscoveredResponse[];
  /** OAS security requirement objects, e.g. [{ bearerAuth: [] }]. */
  security?: Array<Record<string, string[]>>;
  /**
   * Existing-system OpenAPI extensions only (x-protocol, x-websocket, ...).
   * Scan provenance never lives here — it belongs to the sidecar.
   */
  extensions?: Record<string, unknown>;
  confidence: Confidence;
  origin: SourceLocation;
  gaps?: GapCode[];
}

export interface DiscoveredComponent {
  readonly name: string;
  readonly schema: JsonSchema;
  readonly origin?: SourceLocation;
}

export interface DiscoveredSecurityScheme {
  readonly name: string;
  /** Canonical OAS security scheme object. */
  readonly scheme: Record<string, unknown>;
}

export interface DiscoveredServer {
  readonly url: string;
  readonly description?: string;
}

export interface DiscoveredUnresolved {
  /** Stable reason code, e.g. "dynamic-path", "unresolved-mount". */
  readonly reason: string;
  readonly message: string;
  readonly origin: SourceLocation;
}

export interface DiscoveredProject {
  readonly title: string;
  readonly version?: string;
  readonly description?: string;
  readonly servers?: readonly DiscoveredServer[];
  readonly operations: readonly DiscoveredOperation[];
  readonly components?: readonly DiscoveredComponent[];
  readonly securitySchemes?: readonly DiscoveredSecurityScheme[];
  /** Static analysis could not decide these; they never reach `paths`. */
  readonly unresolved?: readonly DiscoveredUnresolved[];
}

export interface DiscoveryOptions {
  openapiVersion?: "3.2.0";
  /** When true, gap-bearing operations still emit but with diagnostics. */
  allowGaps?: boolean;
  validate?: boolean;
}

export interface DiscoveryResult {
  readonly document: import("./types.js").OpenApiDocument;
  readonly project: DiscoveredProject;
  readonly diagnostics: import("./types.js").Diagnostic[];
  readonly ok: boolean;
  readonly documentValid: boolean;
}
