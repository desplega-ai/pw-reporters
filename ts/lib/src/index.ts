// Reporter (default export)
export { default } from "./reporter";
export { default as PlaywrightReporter } from "./reporter";
export type { ReporterConfig } from "./reporter";

// Types
export type {
  SerializedTestStatus,
  SerializedLocation,
  SerializedAnnotation,
  SerializedAttachment,
  SerializedTestError,
  SerializedTestStep,
  SerializedTestResult,
  SerializedTestCase,
  SerializedSuite,
  SerializedProject,
  SerializedConfig,
  SerializedFullResult,
  // Event types
  ReporterEvent,
  OnBeginEvent,
  OnTestBeginEvent,
  OnTestEndEvent,
  OnStepBeginEvent,
  OnStepEndEvent,
  OnErrorEvent,
  OnEndEvent,
  OnStdOutEvent,
  OnStdErrEvent,
  OnExitEvent,
} from "./types";

// Serializers
export {
  serializeDate,
  serializeBuffer,
  serializeRegExp,
  serializeRegExpArray,
  serializeLocation,
  serializeTestError,
  serializeAttachment,
  serializeTestStep,
  serializeTestResult,
  serializeTestCase,
  serializeSuite,
  serializeProject,
  serializeConfig,
  serializeFullResult,
} from "./serializers";
