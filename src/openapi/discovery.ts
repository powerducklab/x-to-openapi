import type { Diagnostic } from "../core/types.js";
import type {
  Confidence,
  DiscoveredMediaType,
  DiscoveredProject,
  JsonSchema,
} from "../core/discovery.js";
import type { OpenApiDocument } from "../core/types.js";
import { operationId } from "./naming.js";

const STANDARD_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
  "query",
]);

const EVENT_STREAM = "text/event-stream";

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length &&
      a.every((item, index) => deepEqual(item, b[index]))
    );
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.length !== bk.length) return false;
    return ak.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(b, key) &&
        deepEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        ),
    );
  }
  return false;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (structuredClone(value) as T);
}

const REF_PREFIX = "#/components/schemas/";

function rewriteRefs(node: unknown, rename: Map<string, string>): unknown {
  if (Array.isArray(node)) return node.map((item) => rewriteRefs(item, rename));
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith(REF_PREFIX)) {
        const original = value.slice(REF_PREFIX.length);
        out[key] = REF_PREFIX + (rename.get(original) ?? original);
      } else {
        out[key] = rewriteRefs(value, rename);
      }
    }
    return out;
  }
  return node;
}

function collectRefs(node: unknown, sink: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, sink);
  } else if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    for (const [key, value] of Object.entries(record)) {
      if (key === "$ref" && typeof value === "string" && value.startsWith(REF_PREFIX)) {
        sink.add(value.slice(REF_PREFIX.length));
      } else {
        collectRefs(value, sink);
      }
    }
  }
}

function uniqueComponentName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let suffix = 2;
  while (taken.has(`${name}${suffix}`)) suffix += 1;
  return `${name}${suffix}`;
}

function mediaTypeObject(
  media: DiscoveredMediaType,
  report: (diagnostic: Diagnostic) => void,
  context: string,
): Record<string, unknown> {
  if (media.mediaType === EVENT_STREAM) {
    if (!media.itemSchema && !(media.schema && Object.keys(media.schema).length)) {
      report({
        code: "DISCOVERY_MEDIA_WITHOUT_SCHEMA",
        severity: "error",
        path: context,
        message: `${context}: SSE media type requires itemSchema.`,
      });
      return { itemSchema: {} };
    }
    return media.itemSchema
      ? { itemSchema: clone(media.itemSchema) }
      : { itemSchema: clone(media.schema) };
  }
  if (!media.schema || Object.keys(media.schema).length === 0) {
    report({
      code: "DISCOVERY_MEDIA_WITHOUT_SCHEMA",
      severity: "error",
      path: context,
      message: `${context}: media type "${media.mediaType}" has no schema.`,
    });
    return { schema: {} };
  }
  return { schema: clone(media.schema) };
}

const GAP_SEVERITY: Record<Confidence, Diagnostic["severity"]> = {
  high: "info",
  medium: "warning",
  low: "warning",
};

/**
 * Builds a validated OpenAPI 3.2 document from the Discovery IR. The builder
 * is deliberately strict: every emitted operation must be structurally valid;
 * unrecoverable gaps produce error diagnostics rather than guessed content.
 */
export function buildDiscoveryOpenApi32(
  project: DiscoveredProject,
  allowGaps: boolean,
  report: (diagnostic: Diagnostic) => void,
): OpenApiDocument {
  // ---- components.schemas (dedupe by identity, rename on true collision) ----
  const componentSchemas = new Map<string, JsonSchema>();
  const rename = new Map<string, string>();
  const taken = new Set<string>();

  for (const component of project.components ?? []) {
    const finalName = uniqueComponentName(component.name, taken);
    if (finalName !== component.name) {
      const existing = componentSchemas.get(finalName);
      if (existing && deepEqual(existing, component.schema)) {
        rename.set(component.name, finalName);
        continue;
      }
      report({
        code: "DISCOVERY_COMPONENT_NAME_COLLISION",
        severity: "warning",
        source: component.origin?.file,
        message: `Component "${component.name}" collides with a different schema; emitted as "${finalName}".`,
      });
      rename.set(component.name, finalName);
    }
    taken.add(finalName);
    componentSchemas.set(finalName, clone(component.schema));
  }

  // ---- security schemes ----
  const securitySchemes = new Map<string, Record<string, unknown>>();
  for (const scheme of project.securitySchemes ?? []) {
    securitySchemes.set(scheme.name, clone(scheme.scheme));
  }

  const paths: Record<string, Record<string, unknown>> = {};
  const usedOperationIds = new Set<string>();
  const seenRoutes = new Set<string>();

  for (const op of project.operations) {
    const context = `${op.method.toUpperCase()} ${op.path} (${op.origin.file}${op.origin.line ? `:${op.origin.line}` : ""})`;
    const method = op.method.toLowerCase();
    const routeKey = `${op.path}\u0000${method}`;

    if (seenRoutes.has(routeKey)) {
      report({
        code: "DISCOVERY_PATH_CONFLICT",
        severity: "error",
        path: op.path,
        source: op.origin.file,
        message: `Duplicate operation ${context}; skipping the second declaration.`,
      });
      continue;
    }
    seenRoutes.add(routeKey);

    // Gap reporting: the completeness gate upstream normally blocks these.
    for (const gap of op.gaps ?? []) {
      report({
        code: "DISCOVERY_GAP",
        severity: allowGaps ? GAP_SEVERITY[op.confidence] : "error",
        path: op.path,
        source: op.origin.file,
        message: `${context}: unresolved gap "${gap}".`,
      });
    }

    const operation: Record<string, unknown> = {};

    if (op.summary) operation.summary = op.summary;
    if (op.description) operation.description = op.description;

    const preferredId = op.operationId ?? "";
    const id = preferredId
      ? (() => {
          const final = uniqueComponentName(preferredId, usedOperationIds);
          if (final !== preferredId) {
            report({
              code: "OPERATION_ID_COLLISION",
              severity: "info",
              path: op.path,
              message: `operationId "${preferredId}" was already used; renamed to "${final}".`,
            });
          }
          usedOperationIds.add(final);
          return final;
        })()
      : operationId(method, op.path, usedOperationIds);
    usedOperationIds.add(id);
    operation.operationId = id;

    if (op.tags && op.tags.length > 0) operation.tags = [...new Set(op.tags)];

    // ---- parameters, with path-template consistency enforced ----
    const templateParams = new Set(
      [...op.path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!),
    );
    const declaredNames = new Set<string>();
    const parameters: Record<string, unknown>[] = [];

    for (const parameter of op.parameters ?? []) {
      if (parameter.in === "path") {
        if (!templateParams.has(parameter.name)) {
          report({
            code: "DISCOVERY_PATH_PARAM_MISMATCH",
            severity: "warning",
            path: op.path,
            source: op.origin.file,
            message: `${context}: path parameter "${parameter.name}" is not present in the path template.`,
          });
        }
        declaredNames.add(parameter.name);
        parameters.push({
          name: parameter.name,
          in: "path",
          required: true,
          ...(parameter.description ? { description: parameter.description } : {}),
          schema: parameter.schema && Object.keys(parameter.schema).length
            ? (rewriteRefs(clone(parameter.schema), rename) as JsonSchema)
            : { type: "string" },
        });
      } else {
        declaredNames.add(parameter.name);
        const item: Record<string, unknown> = {
          name: parameter.name,
          in: parameter.in,
          ...(parameter.required ? { required: true } : {}),
          ...(parameter.description ? { description: parameter.description } : {}),
          schema: parameter.schema && Object.keys(parameter.schema).length
            ? (rewriteRefs(clone(parameter.schema), rename) as JsonSchema)
            : {},
        };
        parameters.push(item);
      }
    }

    for (const missing of templateParams) {
      if (!declaredNames.has(missing)) {
        report({
          code: "DISCOVERY_PATH_PARAM_MISMATCH",
          severity: "warning",
          path: op.path,
          source: op.origin.file,
          message: `${context}: path template parameter "{${missing}}" has no parameter definition; emitted as string.`,
        });
        parameters.push({
          name: missing,
          in: "path",
          required: true,
          schema: { type: "string" },
        });
      }
    }

    if (parameters.length > 0) operation.parameters = parameters;

    // ---- request body ----
    if (op.requestBody && op.requestBody.content.length > 0) {
      const content: Record<string, unknown> = {};
      for (const media of op.requestBody.content) {
        content[media.mediaType] = mediaTypeObject(media, report, context);
      }
      operation.requestBody = {
        ...(op.requestBody.required ? { required: true } : {}),
        content,
      };
    }

    // ---- responses ----
    if (op.responses.length === 0) {
      report({
        code: "DISCOVERY_RESPONSE_MISSING",
        severity: "error",
        path: op.path,
        source: op.origin.file,
        message: `${context}: operation declares no responses.`,
      });
    }
    const responses: Record<string, unknown> = {};
    for (const response of op.responses) {
      const item: Record<string, unknown> = { description: response.description };
      if (response.content && response.content.length > 0) {
        const content: Record<string, unknown> = {};
        for (const media of response.content) {
          content[media.mediaType] = mediaTypeObject(media, report, `${context} ${response.statusCode}`);
        }
        item.content = content;
      }
      if (response.headers && Object.keys(response.headers).length > 0) {
        item.headers = Object.fromEntries(
          Object.entries(response.headers).map(([name, schema]) => [
            name,
            { schema: rewriteRefs(clone(schema), rename) },
          ]),
        );
      }
      responses[response.statusCode] = item;
    }
    if (Object.keys(responses).length === 0) {
      responses.default = { description: "Response" };
    }
    operation.responses = responses;

    // ---- security ----
    if (op.security && op.security.length > 0) {
      const requirements: Record<string, string[]>[] = [];
      for (const requirement of op.security) {
        const cleaned: Record<string, string[]> = {};
        for (const [name, scopes] of Object.entries(requirement)) {
          if (!securitySchemes.has(name)) {
            report({
              code: "DISCOVERY_SECURITY_SCHEME_MISSING",
              severity: "error",
              path: op.path,
              source: op.origin.file,
              message: `${context}: security requirement references undefined scheme "${name}".`,
            });
            continue;
          }
          cleaned[name] = [...scopes];
        }
        if (Object.keys(cleaned).length > 0) requirements.push(cleaned);
      }
      if (requirements.length > 0) operation.security = requirements;
    }

    // ---- existing-system extensions only ----
    for (const [key, value] of Object.entries(op.extensions ?? {})) {
      if (!key.startsWith("x-")) {
        report({
          code: "DISCOVERY_GAP",
          severity: "warning",
          path: op.path,
          message: `${context}: ignoring non-extension key "${key}".`,
        });
        continue;
      }
      operation[key] = clone(value);
    }

    const pathItem = (paths[op.path] ??= {});
    if (STANDARD_METHODS.has(method)) {
      pathItem[method] = operation;
    } else {
      const additional = (pathItem.additionalOperations ??= {}) as Record<
        string,
        unknown
      >;
      additional[method.toUpperCase()] = operation;
    }
  }

  // ---- validate every $ref resolves after renames ----
  const allRefs = new Set<string>();
  collectRefs(paths, allRefs);
  collectRefs(Object.fromEntries(componentSchemas), allRefs);
  for (const ref of allRefs) {
    if (!componentSchemas.has(ref)) {
      report({
        code: "DISCOVERY_COMPONENT_NOT_FOUND",
        severity: "error",
        message: `$ref "#/components/schemas/${ref}" does not resolve to any discovered component.`,
      });
    }
  }

  const components: Record<string, unknown> = {};
  if (securitySchemes.size > 0)
    components.securitySchemes = Object.fromEntries(securitySchemes);
  if (componentSchemas.size > 0)
    components.schemas = Object.fromEntries(componentSchemas);

  return {
    openapi: "3.2.0",
    info: {
      title: project.title,
      version: project.version ?? "1.0.0",
      ...(project.description ? { description: project.description } : {}),
    },
    servers:
      project.servers && project.servers.length > 0
        ? project.servers.map((server) => ({
            url: server.url,
            ...(server.description ? { description: server.description } : {}),
          }))
        : [{ url: "/" }],
    paths,
    ...(Object.keys(components).length > 0 ? { components } : {}),
  } as unknown as OpenApiDocument;
}
