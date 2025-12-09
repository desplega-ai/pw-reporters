"""Async Playwright tests with base_url."""

from playwright.async_api import Page, expect


class TestDesplega:
    async def test_should_display_page_title(self, page: Page):
        await page.goto("/")
        await expect(page.get_by_text("desplega.ai evals")).to_be_visible()

    async def test_should_navigate_to_table_demo(self, page: Page):
        await page.goto("/")
        await page.get_by_role("link", name="table").first.click()
        await expect(page.get_by_text("Table Demo")).to_be_visible()
