import type {
  FullConfig, FullResult, Reporter, Suite, TestCase, TestError, TestResult,
  TestStep
} from '@playwright/test/reporter';

const serializeTest = (test: TestCase) => ({
  id: test.id,
  title: test.title,
  tags: test.tags,
  expectedStatus: test.expectedStatus,
  location: test.location,
});

const serializeTestStep = (step: TestStep) => ({
  title: step.title,
  duration: step.duration,
  annotations: step.annotations,
  attachements: step.attachments,
  category: step.category,
  location: step.location,
  parent: step.parent?.title || null,
  error: step.error,
  // steps: step.steps.map(serializeTestStep),
  steps: step.steps.map(s => s.title),
});

const serializeResult = (result: TestResult) => ({
  startTime: result.startTime,
  duration: result.duration,
  status: result.status,
  // steps: result.steps.map(serializeTestStep),
  steps: result.steps.map(s => s.title),
  error: result.error,
  errors: result.errors,
});

class MyReporter implements Reporter {
  onBegin(config: FullConfig, suite: Suite) {
    console.log(JSON.stringify({
      event: 'onBegin',
      config: {
        configFile: config.configFile,
        rootDir: config.rootDir,
        shard: config.shard,
        project: config.projects.map(p => ({
          name: p.name,
          dependencies: p.dependencies,
          testDir: p.testDir,
        }))
      },
      suite: {
        title: suite.title,
        tests: suite.tests.map(serializeTest),
      },
    }, null, 2));
  }

  onTestBegin(test: TestCase, result: TestResult) {
    console.log(JSON.stringify({
      event: 'onTestBegin',
      test: serializeTest(test),
      result: serializeResult(result),
    }, null, 2));
  }

  onTestEnd(test: TestCase, result: TestResult) {
    console.log(JSON.stringify({
      event: 'onTestEnd',
      test: serializeTest(test),
      result: serializeResult(result),
    }, null, 2));
  }

  onStepBegin(test: TestCase, result: TestResult, step: TestStep) {
    console.log(JSON.stringify({
      event: 'onStepBegin',
      test: serializeTest(test),
      result: serializeResult(result),
      step: serializeTestStep(step),
    }, null, 2));
  }

  onStepEnd(test: TestCase, result: TestResult, step: TestStep) {
    console.log(JSON.stringify({
      event: 'onStepEnd',
      test: serializeTest(test),
      result: serializeResult(result),
      step: serializeTestStep(step),
    }, null, 2));
  }

  onError(error: TestError) {
    console.log(JSON.stringify({
      event: 'onError',
      error,
    }, null, 2));
  }

  onExit(): Promise<void> {
    console.log(JSON.stringify({
      event: 'onExit',
    }, null, 2));

    // TODO(taras)
    // Upload report

    return Promise.resolve();
  }

  onStdErr(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    console.log(JSON.stringify({
      event: 'onStdErr',
      chunk: chunk.toString(),
      test: test ? serializeTest(test) : null,
      result: result ? serializeResult(result) : null,
    }, null, 2));
  }

  onStdOut(chunk: string | Buffer, test?: TestCase, result?: TestResult) {
    console.log(JSON.stringify({
      event: 'onStdOut',
      chunk: chunk.toString(),
      test: test ? serializeTest(test) : null,
      result: result ? serializeResult(result) : null,
    }, null, 2));
  }

  onEnd(result: FullResult) {
    console.log(JSON.stringify({
      event: 'onEnd',
      result,
    }, null, 2));
  }
}

export default MyReporter;
