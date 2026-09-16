# @powerduck/x-to-openapi

[![npm version](https://img.shields.io/npm/v/@powerduck/x-to-openapi)](https://www.npmjs.com/package/@powerduck/x-to-openapi)
[![license](https://img.shields.io/npm/l/@powerduck/x-to-openapi)](https://github.com/powerducklab/x-to-openapi/blob/main/LICENSE)
[![downloads](https://img.shields.io/npm/dm/@powerduck/x-to-openapi)](https://www.npmjs.com/package/@powerduck/x-to-openapi)

Production-grade, extensible TypeScript framework that converts source formats (**curl commands** and **Postman Collections v2.0/v2.1.0**) into valid **OpenAPI 3.2** documents. Built for CI pipelines, API documentation generation, and reverse-engineering HTTP traffic.

---

Powerduck is an open-source developer tooling platform for teams building modern API workflows.

- **cURL to OpenAPI** — Convert single or batch curl commands into OpenAPI 3.2 specs
- **Postman to OpenAPI** — Import Postman Collections v2.0/v2.1.0 and convert to OpenAPI
- **Schema Inference** — Automatically infer JSON schemas from request/response bodies
- **Parameter Extraction** — Extract path, query, header, and cookie parameters from requests
- **Authentication Detection** — Detect Bearer tokens, API keys, Basic auth, and OAuth2
- **Content-Type Handling** — JSON, form-data, x-www-form-urlencoded, and raw payloads
- **Batch Processing** — Convert hundreds of requests in a single call with deduplication
- **Validation Built-in** — Generated specs pass OpenAPI validation with zero errors
- **Extensible Architecture** — Plugin system for custom source formats and transformers

---

## Quick Start

### Install

```bash
npm install @powerduck/x-to-openapi
```

### Single curl command

```typescript
import { curlToOpenApi } from "@powerduck/x-to-openapi";

const result = await curlToOpenApi(
  `curl -X POST https://api.example.com/users \
    -H 'Content-Type: application/json' \
    --data '{"name":"Ada","age":36}'`,
);

console.log(JSON.stringify(result.document, null, 2));
```

### Batch of commands

```typescript
import { curlToOpenApi } from "@powerduck/x-to-openapi";

const result = await curlToOpenApi(
  [
    "curl https://api.example.com/users",
    "curl https://api.example.com/users/123",
    "curl -X POST https://api.example.com/users -H 'Content-Type: application/json' --data '{\"name\":\"Ada\"}'",
  ],
  {
    title: "User API",
    version: "2.0.0",
    useServerBasePath: true,
  },
);
```

### Postman Collection

```typescript
import { postmanToOpenApi } from "@powerduck/x-to-openapi";
import { readFileSync } from "node:fs";

const collection = JSON.parse(
  readFileSync("./postman_collection.json", "utf8"),
);
const result = await postmanToOpenApi(collection, {
  title: "My API",
  version: "1.0.0",
});
```

---

## Links

- [Official Website](https://www.powerduck.com/opensource/x-to-openapi.html)
- [Documentation](https://www.powerduck.com/docs/x-to-openapi/introduction)
- [Live Demo](https://www.powerduck.com/demo/x-to-openapi)
- [GitHub](https://github.com/powerducklab/x-to-openapi)
- [npm](https://www.npmjs.com/package/@powerduck/x-to-openapi)

---

## Features

- **cURL to OpenAPI** — Convert single or batch curl commands into OpenAPI 3.2 specs
- **Postman to OpenAPI** — Import Postman Collections v2.0/v2.1.0 and convert to OpenAPI
- **Schema inference** — Automatically infer JSON schemas from request/response bodies
- **Parameter extraction** — Extract path, query, header, and cookie parameters from requests
- **Authentication detection** — Detect Bearer tokens, API keys, Basic auth, and OAuth2
- **Content-Type handling** — JSON, form-data, x-www-form-urlencoded, and raw payloads
- **Batch processing** — Convert hundreds of requests in a single call with deduplication
- **Validation built-in** — Generated specs pass OpenAPI validation with zero errors
- **Extensible architecture** — Plugin system for custom source formats and transformers
- **Server base path** — Optionally extract server base path from request URLs
- **Common headers** — Include or exclude common headers like User-Agent, Accept, etc.
- **Examples included** — Generate example values for parameters and request bodies
- **Dual ESM/CJS** — Works with `import` and `require`, with bundled TypeScript declarations

---

## API Reference

### `curlToOpenApi(input, options?)`

Convert one or more curl commands to an OpenAPI document.

```typescript
import { curlToOpenApi } from "@powerduck/x-to-openapi";

const result = await curlToOpenApi("curl https://api.example.com/users", {
  title: "My API",
  version: "1.0.0",
  includeExamples: true,
});
```

#### Options

| Option                 | Type       | Default           | Description                                 |
| ---------------------- | ---------- | ----------------- | ------------------------------------------- |
| `title`                | `string`   | `"Generated API"` | API title                                   |
| `version`              | `string`   | `"1.0.0"`         | API version                                 |
| `description`          | `string`   | -                 | API description                             |
| `servers`              | `string[]` | -                 | Server URLs (auto-detected if not provided) |
| `useServerBasePath`    | `boolean`  | `true`            | Extract base path from URLs                 |
| `includeCommonHeaders` | `boolean`  | `false`           | Include common HTTP headers                 |
| `includeCookies`       | `boolean`  | `false`           | Include cookie parameters                   |
| `includeExamples`      | `boolean`  | `true`            | Generate example values                     |
| `validate`             | `boolean`  | `true`            | Validate generated spec                     |
| `strict`               | `boolean`  | `false`           | Strict mode (fail on warnings)              |

### `postmanToOpenApi(collection, options?)`

Convert a Postman Collection to an OpenAPI document.

```typescript
import { postmanToOpenApi } from "@powerduck/x-to-openapi";

const result = await postmanToOpenApi(collection, {
  title: "Postman Import",
  version: "1.0.0",
});
```

### `ConvertResult`

```typescript
interface ConvertResult {
  document: OpenAPIDocument;
  warnings: Warning[];
  errors: Error[];
  stats: {
    totalRequests: number;
    convertedRequests: number;
    skippedRequests: number;
    paths: number;
    operations: number;
    schemas: number;
  };
}
```

---

## TypeScript Types

```typescript
import type {
  ConvertOptions,
  ConvertResult,
  Warning,
  OpenAPIDocument,
  PostmanCollection,
} from "@powerduck/x-to-openapi";
```

---

## License

MIT © [POWERDUCK LIMITED](https://www.powerduck.com)
