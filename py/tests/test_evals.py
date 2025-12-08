import re
from playwright.sync_api import Page, expect


class TestDesplega:
    def test_should_display_page_title(self, page: Page):
        page.goto("/")
        expect(page.get_by_text("desplega.ai evals")).to_be_visible()
