"""
Auto-instrumentation for Playwright Page, Locator, and expect.

This module patches Playwright classes at import time to emit step events
for all actions, without requiring any code changes in tests.
"""

import time
import functools
from typing import Callable, Any

from .reporter import reporter

# Track if we've already patched to avoid double-patching
_patched = False


def wrap_async_method(method: Callable, category: str, title_fn: Callable[..., str]):
    """Wrap an async method to emit step events."""
    @functools.wraps(method)
    async def wrapper(*args, **kwargs):
        title = title_fn(*args, **kwargs)
        start_time = time.time()

        reporter.on_step_begin(title, category)

        error = None
        try:
            result = await method(*args, **kwargs)
            return result
        except Exception as e:
            error = str(e)
            raise
        finally:
            duration_ms = (time.time() - start_time) * 1000
            reporter.on_step_end(title, category, duration_ms, error)

    # Mark as wrapped to avoid double-wrapping
    wrapper._pw_reporter_wrapped = True
    return wrapper


def wrap_sync_method(method: Callable, category: str, title_fn: Callable[..., str]):
    """Wrap a sync method to emit step events."""
    @functools.wraps(method)
    def wrapper(*args, **kwargs):
        title = title_fn(*args, **kwargs)
        start_time = time.time()

        reporter.on_step_begin(title, category)

        error = None
        try:
            result = method(*args, **kwargs)
            return result
        except Exception as e:
            error = str(e)
            raise
        finally:
            duration_ms = (time.time() - start_time) * 1000
            reporter.on_step_end(title, category, duration_ms, error)

    wrapper._pw_reporter_wrapped = True
    return wrapper


def is_wrapped(method: Callable) -> bool:
    """Check if a method is already wrapped."""
    return getattr(method, '_pw_reporter_wrapped', False)


def patch_page_class(PageClass, is_async: bool = True):
    """Patch a Page class with instrumentation."""
    wrap = wrap_async_method if is_async else wrap_sync_method

    # Navigation methods
    methods_navigation = [
        ("goto", lambda self, url, **kw: f"page.goto({url})"),
        ("reload", lambda self, **kw: "page.reload()"),
        ("go_back", lambda self, **kw: "page.go_back()"),
        ("go_forward", lambda self, **kw: "page.go_forward()"),
    ]

    # Action methods
    methods_action = [
        ("click", lambda self, selector, **kw: f"page.click({selector})"),
        ("dblclick", lambda self, selector, **kw: f"page.dblclick({selector})"),
        ("fill", lambda self, selector, value, **kw: f"page.fill({selector}, {value!r})"),
        ("type", lambda self, selector, text, **kw: f"page.type({selector}, {text!r})"),
        ("press", lambda self, selector, key, **kw: f"page.press({selector}, {key})"),
        ("check", lambda self, selector, **kw: f"page.check({selector})"),
        ("uncheck", lambda self, selector, **kw: f"page.uncheck({selector})"),
        ("select_option", lambda self, selector, **kw: f"page.select_option({selector})"),
        ("hover", lambda self, selector, **kw: f"page.hover({selector})"),
        ("focus", lambda self, selector, **kw: f"page.focus({selector})"),
        ("drag_and_drop", lambda self, source, target, **kw: f"page.drag_and_drop({source}, {target})"),
        ("screenshot", lambda self, **kw: "page.screenshot()"),
        ("pdf", lambda self, **kw: "page.pdf()"),
        ("set_input_files", lambda self, selector, files, **kw: f"page.set_input_files({selector}, ...)"),
    ]

    # Wait methods
    methods_wait = [
        ("wait_for_selector", lambda self, selector, **kw: f"page.wait_for_selector({selector})"),
        ("wait_for_load_state", lambda self, state="load", **kw: f"page.wait_for_load_state({state})"),
        ("wait_for_url", lambda self, url, **kw: f"page.wait_for_url({url})"),
        ("wait_for_timeout", lambda self, timeout, **kw: f"page.wait_for_timeout({timeout})"),
        ("wait_for_function", lambda self, expression, **kw: f"page.wait_for_function(...)"),
    ]

    for name, title_fn in methods_navigation:
        if hasattr(PageClass, name):
            original = getattr(PageClass, name)
            if not is_wrapped(original):
                setattr(PageClass, name, wrap(original, "navigation", title_fn))

    for name, title_fn in methods_action:
        if hasattr(PageClass, name):
            original = getattr(PageClass, name)
            if not is_wrapped(original):
                setattr(PageClass, name, wrap(original, "action", title_fn))

    for name, title_fn in methods_wait:
        if hasattr(PageClass, name):
            original = getattr(PageClass, name)
            if not is_wrapped(original):
                setattr(PageClass, name, wrap(original, "wait", title_fn))


def patch_locator_class(LocatorClass, is_async: bool = True):
    """Patch a Locator class with instrumentation."""
    wrap = wrap_async_method if is_async else wrap_sync_method

    def get_locator_desc(locator) -> str:
        """Get a human-readable description of the locator."""
        return str(locator)

    methods_action = [
        ("click", lambda self, **kw: f"locator({get_locator_desc(self)}).click()"),
        ("dblclick", lambda self, **kw: f"locator({get_locator_desc(self)}).dblclick()"),
        ("fill", lambda self, value, **kw: f"locator({get_locator_desc(self)}).fill({value!r})"),
        ("type", lambda self, text, **kw: f"locator({get_locator_desc(self)}).type({text!r})"),
        ("press", lambda self, key, **kw: f"locator({get_locator_desc(self)}).press({key})"),
        ("check", lambda self, **kw: f"locator({get_locator_desc(self)}).check()"),
        ("uncheck", lambda self, **kw: f"locator({get_locator_desc(self)}).uncheck()"),
        ("select_option", lambda self, **kw: f"locator({get_locator_desc(self)}).select_option()"),
        ("hover", lambda self, **kw: f"locator({get_locator_desc(self)}).hover()"),
        ("focus", lambda self, **kw: f"locator({get_locator_desc(self)}).focus()"),
        ("scroll_into_view_if_needed", lambda self, **kw: f"locator({get_locator_desc(self)}).scroll_into_view_if_needed()"),
        ("screenshot", lambda self, **kw: f"locator({get_locator_desc(self)}).screenshot()"),
        ("set_input_files", lambda self, files, **kw: f"locator({get_locator_desc(self)}).set_input_files(...)"),
        ("select_text", lambda self, **kw: f"locator({get_locator_desc(self)}).select_text()"),
        ("clear", lambda self, **kw: f"locator({get_locator_desc(self)}).clear()"),
    ]

    methods_wait = [
        ("wait_for", lambda self, **kw: f"locator({get_locator_desc(self)}).wait_for()"),
    ]

    for name, title_fn in methods_action:
        if hasattr(LocatorClass, name):
            original = getattr(LocatorClass, name)
            if not is_wrapped(original):
                setattr(LocatorClass, name, wrap(original, "action", title_fn))

    for name, title_fn in methods_wait:
        if hasattr(LocatorClass, name):
            original = getattr(LocatorClass, name)
            if not is_wrapped(original):
                setattr(LocatorClass, name, wrap(original, "wait", title_fn))


def patch_assertions_class(AssertionsClass, is_async: bool = True):
    """Patch LocatorAssertions class with instrumentation."""
    wrap = wrap_async_method if is_async else wrap_sync_method

    def get_locator_desc(assertions) -> str:
        """Get a human-readable description from assertions object."""
        # The locator is nested inside _impl_obj for sync/async wrappers
        impl = getattr(assertions, '_impl_obj', assertions)
        for attr in ('_actual_locator', '_locator', 'actual'):
            if hasattr(impl, attr):
                loc = getattr(impl, attr)
                if loc is not None:
                    return str(loc)
        return "locator"

    methods = [
        ("to_be_visible", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_visible()"),
        ("to_be_hidden", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_hidden()"),
        ("to_be_enabled", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_enabled()"),
        ("to_be_disabled", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_disabled()"),
        ("to_be_checked", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_checked()"),
        ("to_be_focused", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_focused()"),
        ("to_be_editable", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_editable()"),
        ("to_be_empty", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_empty()"),
        ("to_be_attached", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_attached()"),
        ("to_be_in_viewport", lambda self, **kw: f"expect({get_locator_desc(self)}).to_be_in_viewport()"),
        ("to_have_text", lambda self, expected, **kw: f"expect({get_locator_desc(self)}).to_have_text({expected!r})"),
        ("to_contain_text", lambda self, expected, **kw: f"expect({get_locator_desc(self)}).to_contain_text({expected!r})"),
        ("to_have_value", lambda self, value, **kw: f"expect({get_locator_desc(self)}).to_have_value({value!r})"),
        ("to_have_values", lambda self, values, **kw: f"expect({get_locator_desc(self)}).to_have_values(...)"),
        ("to_have_attribute", lambda self, name, value, **kw: f"expect({get_locator_desc(self)}).to_have_attribute({name!r}, {value!r})"),
        ("to_have_class", lambda self, expected, **kw: f"expect({get_locator_desc(self)}).to_have_class({expected!r})"),
        ("to_have_count", lambda self, count, **kw: f"expect({get_locator_desc(self)}).to_have_count({count})"),
        ("to_have_css", lambda self, name, value, **kw: f"expect({get_locator_desc(self)}).to_have_css({name!r}, {value!r})"),
        ("to_have_id", lambda self, id, **kw: f"expect({get_locator_desc(self)}).to_have_id({id!r})"),
        ("to_have_js_property", lambda self, name, value, **kw: f"expect({get_locator_desc(self)}).to_have_js_property({name!r}, ...)"),
        ("to_have_role", lambda self, role, **kw: f"expect({get_locator_desc(self)}).to_have_role({role!r})"),
        ("to_have_accessible_name", lambda self, name, **kw: f"expect({get_locator_desc(self)}).to_have_accessible_name({name!r})"),
        ("to_have_accessible_description", lambda self, description, **kw: f"expect({get_locator_desc(self)}).to_have_accessible_description({description!r})"),
        # Negated versions are handled automatically by Playwright
    ]

    for name, title_fn in methods:
        if hasattr(AssertionsClass, name):
            original = getattr(AssertionsClass, name)
            if not is_wrapped(original):
                setattr(AssertionsClass, name, wrap(original, "assertion", title_fn))


def patch_playwright():
    """Patch all Playwright classes with instrumentation."""
    global _patched
    if _patched:
        return

    try:
        # Patch async API
        from playwright.async_api._generated import Page as AsyncPage
        from playwright.async_api._generated import Locator as AsyncLocator
        from playwright.async_api._generated import LocatorAssertions as AsyncLocatorAssertions

        patch_page_class(AsyncPage, is_async=True)
        patch_locator_class(AsyncLocator, is_async=True)
        patch_assertions_class(AsyncLocatorAssertions, is_async=True)
    except ImportError:
        pass

    try:
        # Patch sync API
        from playwright.sync_api._generated import Page as SyncPage
        from playwright.sync_api._generated import Locator as SyncLocator
        from playwright.sync_api._generated import LocatorAssertions as SyncLocatorAssertions

        patch_page_class(SyncPage, is_async=False)
        patch_locator_class(SyncLocator, is_async=False)
        patch_assertions_class(SyncLocatorAssertions, is_async=False)
    except ImportError:
        pass

    _patched = True
