"""
pytest-pw-reporter: Automatic step-level reporting for Playwright tests.

Install and it just works - no code changes required.
"""

from .reporter import JSONReporter, reporter
from .plugin import pytest_configure

__version__ = "0.1.0"
__all__ = ["JSONReporter", "reporter", "pytest_configure"]
