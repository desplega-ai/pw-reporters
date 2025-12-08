import pytest
from playwright.async_api import Page, expect


class TestDesplega:
    @pytest.mark.asyncio
    async def test_should_display_page_title(self, page: Page):
        await page.goto("/")
        await expect(page.get_by_text("desplega.ai evals")).to_be_visible()
