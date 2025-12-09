# JSON Schema Generation for Reporter Protocol

## Overview

Generate JSON Schema from the existing TypeScript types in `ts/lib/src/types.ts` to enable Pydantic model generation in downstream Python projects. This establishes the reporter protocol as a well-defined, cross-language contract.

## Current State Analysis

### Existing TypeScript Types (`ts/lib/src/types.ts`)
- 14 serialized data types (e.g., `SerializedTestCase`, `SerializedTestResult`)
- 10 event types (e.g., `OnBeginEvent`, `OnTestEndEvent`)
- `ReporterEvent` union type covering all events
- All types are already JSON-safe (strings, numbers, booleans, arrays, objects)

### What We Have
- Clean TypeScript interfaces ready for schema generation
- No Zod schemas (and we don't need them - just JSON Schema output)

### What We Need
- JSON Schema file(s) that can be used with `datamodel-code-generator` in other repos
- A script to regenerate schemas when types change

## Desired End State

A `ts/lib/schemas/` directory containing:
1. `reporter-events.schema.json` - Complete JSON Schema for all reporter types and events
2. A `generate-schema` script in `package.json` for regeneration

### Verification:
- `bun run generate-schema` produces valid JSON Schema
- Schema validates against sample event JSON
- Schema can be consumed by `datamodel-codegen` to produce Pydantic models

## What We're NOT Doing

- Adding Zod (unnecessary complexity for this use case)
- Modifying existing TypeScript interfaces
- Generating Pydantic models in this repo (that's for downstream)
- Adding runtime validation (serializers already handle this)

---

## Implementation Approach

Use `ts-json-schema-generator` to generate JSON Schema directly from TypeScript interfaces. This is simpler than introducing Zod because:
1. Zero code changes to existing types
2. Single CLI command
3. Works with TypeScript's type system directly

---

## Phase 1: Setup and Schema Generation

### Overview
Install `ts-json-schema-generator` and create the generation script.

### Changes Required:

#### 1. Install dependency
```bash
cd ts && bun add -d ts-json-schema-generator
```

#### 2. Create schema generation config
**File**: `ts/schema-config.json`

```json
{
  "path": "lib/src/types.ts",
  "type": "ReporterEvent",
  "tsconfig": "tsconfig.json",
  "expose": "all",
  "topRef": true,
  "jsDoc": "extended",
  "sortProps": true,
  "strictTuples": true,
  "skipTypeCheck": false,
  "encodeRefs": false
}
```

#### 3. Add npm script
**File**: `ts/package.json` (add to scripts)

```json
{
  "scripts": {
    "generate-schema": "ts-json-schema-generator --config schema-config.json --out schemas/reporter-events.schema.json"
  }
}
```

#### 4. Create schemas directory
```bash
mkdir -p ts/schemas
```

#### 5. Add schemas to package exports
**File**: `ts/package.json` (add to exports and files)

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./schema.json": "./schemas/reporter-events.schema.json"
  },
  "files": [
    "dist",
    "lib/src",
    "schemas"
  ]
}
```

### Success Criteria:

#### Automated Verification:
- [x] `cd ts && bun run generate-schema` completes without errors
- [x] `ls ts/schemas/reporter-events.schema.json` exists
- [x] Schema is valid JSON: `cat ts/schemas/reporter-events.schema.json | jq .`

#### Manual Verification:
- [ ] Schema contains definitions for all event types
- [ ] Schema contains `ReporterEvent` as the root type with discriminated union

---

## Phase 2: Schema Validation Test

### Overview
Add a simple test to ensure the generated schema matches our TypeScript types.

### Changes Required:

#### 1. Create schema validation test
**File**: `ts/lib/src/schema.test.ts`

```typescript
import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

describe("JSON Schema", () => {
  const schemaPath = join(__dirname, "../../schemas/reporter-events.schema.json");
  let schema: any;

  beforeAll(() => {
    if (!existsSync(schemaPath)) {
      throw new Error(
        "Schema file not found. Run `bun run generate-schema` first."
      );
    }
    schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
  });

  test("schema file exists and is valid JSON", () => {
    expect(schema).toBeDefined();
    expect(schema.$schema).toContain("json-schema.org");
  });

  test("schema has ReporterEvent definition", () => {
    // Could be at root or in definitions depending on generator config
    const hasReporterEvent =
      schema.$ref?.includes("ReporterEvent") ||
      schema.definitions?.ReporterEvent ||
      schema.$defs?.ReporterEvent;
    expect(hasReporterEvent).toBeTruthy();
  });

  test("schema includes all event types", () => {
    const schemaStr = JSON.stringify(schema);
    const eventTypes = [
      "OnBeginEvent",
      "OnTestBeginEvent",
      "OnTestEndEvent",
      "OnStepBeginEvent",
      "OnStepEndEvent",
      "OnErrorEvent",
      "OnEndEvent",
      "OnStdOutEvent",
      "OnStdErrEvent",
      "OnExitEvent",
    ];

    for (const eventType of eventTypes) {
      expect(schemaStr).toContain(eventType);
    }
  });

  test("schema includes core data types", () => {
    const schemaStr = JSON.stringify(schema);
    const dataTypes = [
      "SerializedTestCase",
      "SerializedTestResult",
      "SerializedTestStep",
      "SerializedConfig",
      "SerializedSuite",
    ];

    for (const dataType of dataTypes) {
      expect(schemaStr).toContain(dataType);
    }
  });
});
```

### Success Criteria:

#### Automated Verification:
- [ ] `cd ts && bun test lib/src/schema.test.ts` passes

---

## Phase 3: Export BaseEvent for Protocol Documentation

### Overview
The `BaseEvent` interface is currently not exported (it's used internally). Export it so the protocol is fully documented.

### Changes Required:

#### 1. Export BaseEvent in types.ts
**File**: `ts/lib/src/types.ts`

Change line 203 from:
```typescript
interface BaseEvent {
```
to:
```typescript
export interface BaseEvent {
```

#### 2. Add BaseEvent to index.ts exports
**File**: `ts/lib/src/index.ts`

Add `BaseEvent` to the type exports.

### Success Criteria:

#### Automated Verification:
- [ ] `cd ts && bun run typecheck` passes
- [ ] `cd ts && bun run generate-schema` includes BaseEvent in output

---

## Phase 4: Documentation

### Overview
Document the schema generation process and how to use the schema downstream.

### Changes Required:

#### 1. Add section to README
**File**: `ts/README.md` (add section)

```markdown
## JSON Schema

This package exports a JSON Schema for the reporter event protocol:

```bash
# Generate/regenerate the schema
bun run generate-schema
```

### Using with Pydantic (Python)

```bash
# Install datamodel-code-generator
pip install datamodel-code-generator

# Generate Pydantic models from the schema
datamodel-codegen \
  --input node_modules/@desplega.ai/playwright-reporter/schemas/reporter-events.schema.json \
  --input-file-type jsonschema \
  --output models.py \
  --output-model-type pydantic_v2.BaseModel \
  --use-annotated \
  --use-standard-collections \
  --use-union-operator
```

### Protocol Overview

The reporter streams events over WebSocket. Each message is a JSON object with:
- `event`: Discriminator field (e.g., "onTestBegin", "onTestEnd")
- `timestamp`: ISO 8601 timestamp
- `runId`: Unique identifier for the test run

Event types:
| Event | Description |
|-------|-------------|
| `onBegin` | Test run started, includes config and test tree |
| `onTestBegin` | Individual test started |
| `onTestEnd` | Individual test completed |
| `onStepBegin` | Test step started |
| `onStepEnd` | Test step completed |
| `onError` | Global error occurred |
| `onEnd` | Test run completed |
| `onStdOut` | stdout output captured |
| `onStdErr` | stderr output captured |
| `onExit` | Reporter process exiting |
```

### Success Criteria:

#### Automated Verification:
- [ ] README.md contains "JSON Schema" section

#### Manual Verification:
- [ ] Documentation is clear and accurate

---

## Testing Strategy

### Automated Tests:
- Schema existence and validity test
- All event types present in schema
- All data types present in schema

### Manual Testing Steps:
1. Run `bun run generate-schema` in `ts/lib/`
2. Inspect generated schema in `schemas/reporter-events.schema.json`
3. Test downstream: run `datamodel-codegen` on the schema to verify it produces valid Pydantic models

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `ts/package.json` | Modify (add devDep, script, exports) |
| `ts/schema-config.json` | Create |
| `ts/schemas/reporter-events.schema.json` | Generate |
| `ts/lib/src/schema.test.ts` | Create |
| `ts/lib/src/types.ts` | Modify (export BaseEvent) |
| `ts/lib/src/index.ts` | Modify (export BaseEvent) |
| `ts/README.md` | Modify (add schema docs) |

---

## References

- Current types: `ts/lib/src/types.ts`
- ts-json-schema-generator: https://github.com/vega/ts-json-schema-generator
- datamodel-code-generator: https://github.com/koxudaxi/datamodel-code-generator
