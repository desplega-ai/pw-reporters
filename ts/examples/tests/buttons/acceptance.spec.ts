import { test, expect } from "@playwright/test";
import { EvalPage } from "../evals-page.pom";

test.describe(
  "Buttons page",
  {
    tag: ["@acceptance", "@ci"],
    annotation: [{ type: "priority", description: "mid" }],
  },
  () => {
    let p: EvalPage;

    test.beforeEach(async ({ page }) => {
      p = new EvalPage(page);
      await p.goto();
    });

    test("should be able to click pill", async ({ page }) => {
      await p.page.goto("/buttons");
      await p.page.waitForTimeout(5000);
      await p.page.getByRole("button", { name: "Pill button" }).click();
      await p.page.waitForTimeout(5000);
      console.log("Clicked Pill button");
      await expect(page.getByText("Selected")).toBeVisible();
    });
  },
);
