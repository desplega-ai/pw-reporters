import type { Page, Locator } from "@playwright/test";

export class EvalPage {
  readonly page: Page;
  readonly tableLink: Locator;

  constructor(page: Page) {
    this.page = page;

    this.tableLink = page.getByRole("link", { name: "table" });
  }

  async goToTable() {
    await this.tableLink.waitFor();
    await this.tableLink.click();
  }

  async goto() {
    await this.page.goto("/");
  }
}
