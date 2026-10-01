import { describe, expect, it } from "vitest";

import { buildDiscoveryOpenApi32 } from "../src/openapi/discovery.js";
import { discoveryToOpenApi } from "../src/discovery.js";
import type {
  DiscoveredOperation,
  DiscoveredProject,
} from "../src/core/discovery.js";
import type { Diagnostic, OpenApiDocument } from "../src/core/types.js";

type TestDocument = OpenApiDocument & {
  paths: Record<string, Record<string, any>>;
  components?: Record<string, any>;
};

const origin = { file: "src/routes/users.ts", line: 12 };

function collect(): { diagnostics: Diagnostic[]; report: (d: Diagnostic) => void } {
  const diagnostics: Diagnostic[] = [];
  return { diagnostics, report: (d) => diagnostics.push(d) };
}

function op(overrides: Partial<DiscoveredOperation>): DiscoveredOperation {
  return {
    method: "get",
    path: "/users",
    responses: [
      {
        statusCode: "200",
        description: "ok",
        confidence: "high",
        content: [
          {
            mediaType: "application/json",
            schema: {
              type: "object",
              properties: { id: { type: "string" } },
            },
          },
        ],
      },
    ],
    confidence: "high",
    origin,
    ...overrides,
  };
}

function project(
  operations: DiscoveredOperation[],
  overrides: Partial<DiscoveredProject> = {},
): DiscoveredProject {
  return {
    title: "Scanned API",
    version: "1.0.0",
    operations,
    servers: [{ url: "http://localhost:3000" }],
    ...overrides,
  };
}

describe("discovery builder", () => {
  it("emits an operation with inline schemas and deterministic operationId", () => {
    const { report } = collect();
    const doc = buildDiscoveryOpenApi32(project([op({})]), true, report) as TestDocument;
    expect(doc.openapi).toBe("3.2.0");
    expect(doc.paths["/users"]!.get.operationId).toBe("getUsers");
    expect(doc.paths["/users"]!.get.responses["200"].content["application/json"].schema)
      .toEqual({ type: "object", properties: { id: { type: "string" } } });
  });

  it("hoists named components and rewrites reused $refs", () => {
    const user = {
      type: "object",
      properties: { id: { type: "string" }, name: { type: "string" } },
      required: ["id"],
    };
    const list = op({
      method: "get",
      path: "/users",
      responses: [
        {
          statusCode: "200",
          description: "ok",
          confidence: "high",
          content: [
            {
              mediaType: "application/json",
              schema: { type: "array", items: { $ref: "#/components/schemas/User" } },
            },
          ],
        },
      ],
    });
    const create = op({
      method: "post",
      path: "/users",
      requestBody: {
        required: true,
        confidence: "high",
        content: [{ mediaType: "application/json", schema: { $ref: "#/components/schemas/User" } }],
      },
      responses: [
        {
          statusCode: "201",
          description: "created",
          confidence: "high",
          content: [
            { mediaType: "application/json", schema: { $ref: "#/components/schemas/User" } },
          ],
        },
      ],
    });
    const { diagnostics, report } = collect();
    const doc = buildDiscoveryOpenApi32(
      project([list, create], { components: [{ name: "User", schema: user }] }),
      true,
      report,
    ) as TestDocument;
    expect(diagnostics).toEqual([]);
    expect(doc.components!.schemas.User).toEqual(user);
    expect(doc.paths["/users"]!.get.responses["200"].content["application/json"].schema.items)
      .toEqual({ $ref: "#/components/schemas/User" });
  });

  it("renames same-named but different components and rewrites all refs", () => {
    const { diagnostics, report } = collect();
    const doc = buildDiscoveryOpenApi32(
      project([op({
        responses: [
          {
            statusCode: "200",
            description: "ok",
            confidence: "high",
            content: [
              { mediaType: "application/json", schema: { $ref: "#/components/schemas/Model" } },
            ],
          },
        ],
      })], {
        components: [
          { name: "Model", schema: { type: "object", properties: { a: { type: "string" } } } },
          { name: "Model", schema: { type: "object", properties: { b: { type: "integer" } } } },
        ],
      }),
      true,
      report,
    ) as TestDocument;
    expect(doc.components!.schemas.Model).toBeDefined();
    expect(doc.components!.schemas.Model2).toBeDefined();
    const collision = diagnostics.find((d) => d.code === "DISCOVERY_COMPONENT_NAME_COLLISION");
    expect(collision).toBeDefined();
  });

  it("emits SSE with x-protocol and text/event-stream itemSchema", () => {
    const { diagnostics, report } = collect();
    const doc = buildDiscoveryOpenApi32(
      project([
        op({
          method: "get",
          path: "/events",
          extensions: { "x-protocol": "sse" },
          responses: [
            {
              statusCode: "200",
              description: "event stream",
              confidence: "high",
              content: [
                {
                  mediaType: "text/event-stream",
                  itemSchema: {
                    type: "object",
                    properties: { event: { type: "string" }, data: { type: "object" } },
                  },
                },
              ],
            },
          ],
        }),
      ]),
      true,
      report,
    ) as TestDocument;
    expect(diagnostics).toEqual([]);
    const media = doc.paths["/events"]!.get.responses["200"].content["text/event-stream"];
    expect(media.itemSchema.properties.event).toEqual({ type: "string" });
    expect(media.schema).toBeUndefined();
    expect(doc.paths["/events"]!.get["x-protocol"]).toBe("sse");
  });

  it("auto-adds missing path parameters and flags the mismatch", () => {
    const { diagnostics, report } = collect();
    const doc = buildDiscoveryOpenApi32(
      project([op({ method: "get", path: "/users/{userId}/orders/{orderId}" })]),
      true,
      report,
    ) as TestDocument;
    const params = doc.paths["/users/{userId}/orders/{orderId}"]!.get.parameters;
    expect(params.map((p: any) => p.name).sort()).toEqual(["orderId", "userId"]);
    expect(params.every((p: any) => p.in === "path" && p.required === true)).toBe(true);
    expect(
      diagnostics.filter((d) => d.code === "DISCOVERY_PATH_PARAM_MISMATCH"),
    ).toHaveLength(2);
  });

  it("errors on media types without schema and on duplicate routes", () => {
    const { diagnostics, report } = collect();
    const doc = buildDiscoveryOpenApi32(
      project([
        op({}),
        op({}), // duplicate GET /users
        op({
          method: "post",
          path: "/webhooks",
          requestBody: {
            confidence: "low",
            content: [{ mediaType: "application/json" }],
          },
        }),
      ]),
      true,
      report,
    ) as TestDocument;
    expect(diagnostics.some((d) => d.code === "DISCOVERY_PATH_CONFLICT")).toBe(true);
    expect(diagnostics.some((d) => d.code === "DISCOVERY_MEDIA_WITHOUT_SCHEMA")).toBe(true);
    // The invalid media type is still emitted (valid document shape) but flagged.
    expect(doc.paths["/webhooks"]!.post.requestBody.content["application/json"]).toEqual({
      schema: {},
    });
  });

  it("keeps unresolved routes out of paths", async () => {
    const result = await discoveryToOpenApi(
      project([op({})], {
        unresolved: [
          {
            reason: "dynamic-path",
            message: "Route path is built from a variable",
            origin: { file: "src/routes/dynamic.ts", line: 44 },
          },
        ],
      }),
    );
    expect(result.diagnostics.some((d) => d.message.includes("dynamic-path"))).toBe(true);
    expect((result.document as TestDocument).paths["/dynamic"]).toBeUndefined();
  });

  it("produces a validator-passing document for a complete project", async () => {
    const result = await discoveryToOpenApi(
      project(
        [
          op({
            method: "get",
            path: "/users/{userId}",
            parameters: [
              {
                name: "userId",
                in: "path",
                required: true,
                schema: { type: "string", format: "uuid" },
                confidence: "high",
              },
            ],
            responses: [
              {
                statusCode: "200",
                description: "user",
                confidence: "high",
                content: [
                  { mediaType: "application/json", schema: { $ref: "#/components/schemas/User" } },
                ],
              },
              {
                statusCode: "404",
                description: "not found",
                confidence: "high",
                content: [
                  {
                    mediaType: "application/json",
                    schema: {
                      type: "object",
                      properties: { message: { type: "string" } },
                    },
                  },
                ],
              },
            ],
            security: [{ bearerAuth: [] }],
          }),
        ],
        {
          components: [
            {
              name: "User",
              schema: {
                type: "object",
                properties: { id: { type: "string" }, name: { type: "string" } },
                required: ["id", "name"],
              },
            },
          ],
          securitySchemes: [
            { name: "bearerAuth", scheme: { type: "http", scheme: "bearer" } },
          ],
        },
      ),
    );
    expect(result.documentValid).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("treats gaps as errors when allowGaps is false", async () => {
    const result = await discoveryToOpenApi(
      project([op({ gaps: ["response-schema-unknown"], confidence: "low" })]),
      { allowGaps: false },
    );
    expect(result.ok).toBe(false);
    expect(result.diagnostics.some((d) => d.code === "DISCOVERY_GAP" && d.severity === "error"))
      .toBe(true);
  });
});
