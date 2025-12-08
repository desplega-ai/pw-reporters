import json
import pytest
from datetime import datetime
from typing import Any
from playwright.async_api import async_playwright, Page, Browser, BrowserContext


# Custom Reporter via pytest hooks
class JSONReporter:
    def __init__(self):
        self.events: list[dict[str, Any]] = []

    def log_event(self, event: str, data: dict[str, Any] | None = None):
        payload = {"event": event, "timestamp": datetime.now().isoformat()}
        if data:
            payload.update(data)
        print(json.dumps(payload, indent=2, default=str))


reporter = JSONReporter()


def pytest_sessionstart(session: pytest.Session):
    reporter.log_event("onBegin", {
        "rootdir": str(session.config.rootdir),
        "args": session.config.args,
    })


def pytest_sessionfinish(session: pytest.Session, exitstatus: int):
    reporter.log_event("onEnd", {
        "exitstatus": exitstatus,
        "testsfailed": session.testsfailed,
        "testscollected": session.testscollected,
    })


def pytest_runtest_logstart(nodeid: str, location: tuple[str, int | None, str]):
    reporter.log_event("onTestBegin", {
        "test": {
            "id": nodeid,
            "location": {
                "file": location[0],
                "line": location[1],
                "name": location[2],
            }
        }
    })


def pytest_runtest_logreport(report: pytest.TestReport):
    if report.when == "call":
        reporter.log_event("onTestEnd", {
            "test": {
                "id": report.nodeid,
                "outcome": report.outcome,
                "duration": report.duration,
            },
            "result": {
                "status": report.outcome,
                "duration": report.duration,
            }
        })
        if report.failed:
            reporter.log_event("onError", {
                "error": str(report.longrepr) if report.longrepr else None,
            })


def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo):
    if call.excinfo is not None:
        reporter.log_event("onStepEnd", {
            "step": {
                "title": call.when,
                "duration": call.duration,
                "error": str(call.excinfo.value),
            }
        })


# Async Playwright fixtures
BASE_URL = "https://evals.desplega.ai"


@pytest.fixture
async def page():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        context = await browser.new_context()
        page = await context.new_page()

        # Monkey-patch goto to support relative URLs
        original_goto = page.goto
        async def goto_with_base(url: str, **kwargs):
            if url.startswith("/"):
                url = BASE_URL + url
            return await original_goto(url, **kwargs)
        page.goto = goto_with_base

        yield page

        await page.close()
        await context.close()
        await browser.close()
