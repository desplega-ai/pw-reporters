"""
Pytest plugin for automatic Playwright instrumentation.

This plugin:
1. Patches Playwright classes at pytest startup
2. Emits JSON events for test lifecycle
3. Captures step-level events for all Playwright actions
"""

import pytest
from .reporter import reporter
from .instrumentation import patch_playwright


def pytest_configure(config: pytest.Config):
    """Called after command line options have been parsed."""
    # Patch Playwright classes before any tests run
    patch_playwright()


def pytest_sessionstart(session: pytest.Session):
    """Called after the Session object has been created."""
    reporter.log_event("onBegin", {
        "rootdir": str(session.config.rootdir),
        "args": session.config.args,
    })


def pytest_sessionfinish(session: pytest.Session, exitstatus: int):
    """Called after whole test run finished."""
    reporter.log_event("onEnd", {
        "exitstatus": exitstatus,
        "testsfailed": session.testsfailed,
        "testscollected": session.testscollected,
    })


def pytest_runtest_logstart(nodeid: str, location: tuple[str, int | None, str]):
    """Called at the start of running the runtest protocol for a single item."""
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
    """Process the TestReport produced for each test phase."""
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
    """Called to create a TestReport for each test phase."""
    if call.excinfo is not None:
        reporter.log_event("onStepEnd", {
            "step": {
                "title": call.when,
                "duration": call.duration,
                "error": str(call.excinfo.value),
            }
        })
