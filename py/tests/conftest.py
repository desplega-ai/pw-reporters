"""Minimal conftest for async Playwright + base_url."""

import pytest
from pathlib import Path
from playwright.async_api import async_playwright, Page

BASE_URL = "https://evals.desplega.ai"
ARTIFACTS_DIR = Path("test-results")


@pytest.fixture
async def page(request) -> Page:  # type: ignore
    ARTIFACTS_DIR.mkdir(exist_ok=True)
    test_name = request.node.name

    async with async_playwright() as p:
        # browser = await p.chromium.connect("ws://localhost:3003")
        browser = await p.chromium.launch()

        # Create context with HAR and video recording
        context = await browser.new_context(
            base_url=BASE_URL,
            record_har_path=ARTIFACTS_DIR / f"{test_name}.har",
            record_video_dir=ARTIFACTS_DIR,
        )

        # Start tracing
        await context.tracing.start(screenshots=True, snapshots=True, sources=True)

        page = await context.new_page()

        yield page  # type: ignore

        # Save trace
        await context.tracing.stop(path=ARTIFACTS_DIR / f"{test_name}.zip")

        # Screenshot on failure
        if hasattr(request.node, "rep_call") and request.node.rep_call.failed:
            await page.screenshot(path=ARTIFACTS_DIR / f"{test_name}-failed.png")

        # Get video reference before closing page
        video = page.video

        # Close page to finalize the video
        await page.close()

        # Save video from remote browser (after page is closed)
        if video:
            await video.save_as(ARTIFACTS_DIR / f"{test_name}.webm")

        await context.close()
        await browser.close()


@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Store test result on the item for the fixture to access."""
    outcome = yield
    rep = outcome.get_result()
    setattr(item, f"rep_{rep.when}", rep)
