import { test, expect } from "@playwright/test";
import { EvalPage } from "./evals-page.pom";

test.describe(
  "Acceptance",
  {
    tag: ["@acceptance", "@ci"],
    annotation: [{ type: "priority", description: "high" }],
  },
  () => {
    let p: EvalPage;

    test.beforeEach(async ({ page }) => {
      p = new EvalPage(page);
      await p.goto();
    });

    [
      ...Array.from({ length: 5 }, (_, i) => ({ name: i.toString() })),
    ].forEach(({ name }) => {
      test(`[${name}] should display page title`, async ({ page }) => {
        await expect(page.getByText("desplega.ai evals")).toBeVisible();
      });
    });

    test("should go to tables", async ({ page }) => {
      await p.goToTable();
      await expect(page.getByText("Table Demo")).toBeVisible();
    });

    test(
      "this test is expected to fail",
      {
        tag: ["@fail"],
      },
      async ({ page }) => {
        test.skip();
        await expect(page.getByText("desplega.ai evalz")).toBeVisible();
      },
    );
  },
);
