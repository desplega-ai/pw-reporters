import { test, expect } from "@playwright/test";
import { EvalPage } from "../evals-page.pom";

test.describe(
  "Table page",
  {
    tag: ["@acceptance", "@ci"],
    annotation: [{ type: "priority", description: "mid" }],
  },
  () => {
    let p: EvalPage;

    test.beforeEach(async ({ page }) => {
      p = new EvalPage(page);
      await p.goto();
      await p.goToTable();
    });

    [
      { name: "John Doe" },
      // { name: 'Jane Smith' },
      { name: "Alice Brown" },
    ].forEach(({ name }) => {
      test(`${name} is present in the table`, async ({ page }) => {
        await expect(page.getByText(name)).toBeVisible();
      });
    });
  },
);
