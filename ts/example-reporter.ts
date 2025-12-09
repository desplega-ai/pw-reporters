import { readdir } from "node:fs/promises";
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from "@playwright/test/reporter";

const serializeTest = (test: TestCase) => ({
  id: test.id,
  path: test.titlePath(),
  title: test.title,
  tags: test.tags,
  expectedStatus: test.expectedStatus,
  location: test.location,
});

const serializeTestStep = (step: TestStep) => ({
  path: step.titlePath(),
  title: step.title,
  duration: step.duration,
  annotations: step.annotations,
  attachements: step.attachments,
  category: step.category,
  location: step.location,
  parent: step.parent?.title || null,
  error: step.error,
  // steps: step.steps.map(serializeTestStep),
  steps: step.steps.map((s) => s.title),
});

const serializeResult = (result: TestResult) => ({
  startTime: result.startTime,
  duration: result.duration,
  status: result.status,
  // steps: result.steps.map(serializeTestStep),
  steps: result.steps.map((s) => s.title),
  error: result.error,
  errors: result.errors,
});

type SerializedSuite = {
  path: string[];
  title: string;
  type: "root" | "project" | "file" | "describe";
  location: Suite["location"];
  tests: string[];
  suites: SerializedSuite[];
};

const serializeSuite = (suite: Suite): SerializedSuite => ({
  path: suite.titlePath(),
  title: suite.title,
  type: suite.type,
  location: suite.location,
  tests: suite.tests.map((t) => t.id),
  suites: suite.suites.map(serializeSuite),
});

const serializeConfig = (config: FullConfig) => ({
  configFile: config.configFile,
  rootDir: config.rootDir,
  shard: config.shard,
  workers: config.workers,
  reporters: config.reporter,
  projects: config.projects.map((p) => ({
    testDir: p.testDir,
    outputDir: p.outputDir,
    name: p.name,
    dependencies: p.dependencies,
    metadata: p.metadata,
    use: p.use,
  })),
});

class MyReporter implements Reporter {
  private ws: WebSocket;

  constructor() {
    this.ws = new WebSocket("ws://localhost:5555");

    this.ws.onopen = () => {
      console.log("WebSocket connection established");
    };

    this.ws.onclose = () => {
      console.log("WebSocket connection closed");
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  printsToStdio() {
    return false;
  }

  onBegin(config: FullConfig, suite: Suite) {
    const d = JSON.stringify(
      {
        event: "onBegin",
        config: serializeConfig(config),
        suite: serializeSuite(suite),
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    const d = JSON.stringify(
      {
        event: "onTestBegin",
        test: serializeTest(test),
        result: serializeResult(result),
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const d = JSON.stringify(
      {
        event: "onTestEnd",
        test: serializeTest(test),
        result: serializeResult(result),
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    const d = JSON.stringify(
      {
        event: "onStepBegin",
        test: serializeTest(test),
        result: serializeResult(result),
        step: serializeTestStep(step),
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    const d = JSON.stringify(
      {
        event: "onStepEnd",
        test: serializeTest(test),
        result: serializeResult(result),
        step: serializeTestStep(step),
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onError(error: TestError) {
    const d = JSON.stringify(
      {
        event: "onError",
        error,
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  async onExit() {
    const d = JSON.stringify(
      {
        event: "onExit",
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);

    // TODO(taras)
    // Upload report

    // Read contents of test-results, print as tree

    const printTree = async (path: string) => {
      const files = await readdir(path, {
        recursive: true,
        withFileTypes: true,
      });
      console.log("Files in test-results:");

      for (const file of files) {
        if (!file.isFile()) continue;

        const fn = `${file.parentPath}/${file.name}`;
        console.log(fn);
      }
    };

    await printTree("test-results");

    this.ws.close(1000, "Reporter finished sending data");
  }

  onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    const d = JSON.stringify(
      {
        event: "onStdErr",
        chunk: chunk.toString(),
        test: test ? serializeTest(test) : null,
        result: result ? serializeResult(result) : null,
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    const d = JSON.stringify(
      {
        event: "onStdOut",
        chunk: chunk.toString(),
        test: test ? serializeTest(test) : null,
        result: result ? serializeResult(result) : null,
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }

  onEnd(result: FullResult) {
    const d = JSON.stringify(
      {
        event: "onEnd",
        result,
      },
      null,
      2,
    );

    console.log(d);
    this.ws.send(d);
  }
}

export default MyReporter;
