import { DiagnosticBag } from "./core/diagnostics.js";
import type {
  DiscoveryOptions,
  DiscoveryResult,
  DiscoveredProject,
} from "./core/discovery.js";
import { buildDiscoveryOpenApi32 } from "./openapi/discovery.js";
import { validateOpenApi32 } from "./validation/openapi32.js";

/**
 * Converts a statically discovered project (Discovery IR) into a validated
 * OpenAPI 3.2 document. Unresolved routes are surfaced as warnings but never
 * silently added to `paths`.
 */
export async function discoveryToOpenApi(
  project: DiscoveredProject,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  if (options.openapiVersion && options.openapiVersion !== "3.2.0") {
    throw new TypeError(
      `Unsupported openapiVersion: ${String(options.openapiVersion)}. Only "3.2.0" is supported.`,
    );
  }

  const bag = new DiagnosticBag(false);
  const allowGaps = options.allowGaps ?? true;

  for (const unresolved of project.unresolved ?? []) {
    bag.report({
      code: "DISCOVERY_GAP",
      severity: "warning",
      source: unresolved.origin.file,
      path: unresolved.origin.line
        ? `${unresolved.origin.file}:${unresolved.origin.line}`
        : unresolved.origin.file,
      message: `Unresolved route (${unresolved.reason}): ${unresolved.message}`,
    });
  }

  const document = buildDiscoveryOpenApi32(project, allowGaps, bag.report);

  let documentValid = true;
  if (options.validate !== false) {
    try {
      const outcome = await validateOpenApi32(document);
      documentValid = outcome.valid;
      for (const diagnostic of outcome.diagnostics) bag.report(diagnostic);
    } catch (cause) {
      bag.report({
        code: "OAS_VALIDATOR_FAILED",
        severity: "warning",
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    }
  }

  return {
    document,
    project,
    diagnostics: bag.items,
    ok: !bag.items.some((diagnostic) => diagnostic.severity === "error"),
    documentValid,
  };
}
