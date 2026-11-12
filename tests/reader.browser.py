#!/usr/bin/env python3
"""Offline bookshelf/reader regression using the repository's bundled books.

Install Playwright (`pip install playwright`; `playwright install chromium`).
Run: python tests/reader.browser.py [--browser /usr/bin/chromium]
PLAYWRIGHT_CHROMIUM_EXECUTABLE also selects a Chromium executable. The server
uses an ephemeral loopback port and builds the same book index as GitHub Pages.
Optional --artifacts-dir saves phone screenshots outside the source tree.
"""
import argparse
from contextlib import contextmanager
from functools import partial
import http.server
import json
import os
from pathlib import Path
import re
import shutil
import threading
from urllib.parse import parse_qs, quote, urlsplit

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
FORMATS = ("txt", "epub", "pdf")


@contextmanager
def serve_site():
    books = [
        {"path": path.relative_to(ROOT).as_posix(), "size": path.stat().st_size}
        for path in sorted((ROOT / "books").rglob("*"))
        if path.is_file() and path.suffix.lower().lstrip(".") in FORMATS
    ]
    assert all(any(book["path"].lower().endswith("." + fmt) for book in books)
               for fmt in FORMATS), "Bundle a TXT, EPUB and PDF to test all readers"

    class Handler(http.server.SimpleHTTPRequestHandler):
        def do_GET(self):
            if urlsplit(self.path).path == "/books/index.json":
                content = json.dumps({"version": 1, "books": books}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            elif self.path == "/favicon.ico":
                self.send_response(204)
                self.end_headers()
            else:
                super().do_GET()

        def copyfile(self, source, outputfile):
            try:
                super().copyfile(source, outputfile)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Closing a reader/tab may cancel an in-flight book download.

        def log_message(self, *_):
            pass

    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", books
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


def wait_reader(page):
    overlay = page.locator(".reading-overlay > iframe")
    expect(overlay).to_have_count(1)
    handle = overlay.element_handle()
    reader = handle.content_frame()
    reader.wait_for_url(re.compile(r"embedded=1"))
    expect(reader.locator("#reader-message")).to_be_hidden(timeout=60_000)
    # Progress is saved only after rendering completes, for all three formats.
    expect(reader.locator("#progress-status")).to_contain_text("%", timeout=60_000)
    return reader


def path_for(card):
    return parse_qs(urlsplit(card.get_attribute("href")).query)["book"][0]


def show_controls(reader):
    if not reader.locator("#reader-topbar").is_visible():
        # The keyboard menu remains reachable even with all visual chrome hidden.
        reader.locator("#reader-controls-toggle").focus()
    expect(reader.locator("#reader-topbar")).to_be_visible()


def check_full_page(reader):
    expect(reader.locator("#reader-topbar")).to_be_hidden()
    expect(reader.locator("#reader-footer")).to_be_hidden()
    expect(reader.locator("#reader-sidebar")).to_be_hidden()
    metrics = reader.evaluate("""() => {
      const stage = document.getElementById('reader-stage').getBoundingClientRect();
      return {x:stage.x, y:stage.y, width:stage.width, height:stage.height,
              vw:innerWidth, vh:innerHeight};
    }""")
    assert metrics["x"] == metrics["y"] == 0, metrics
    assert metrics["width"] == metrics["vw"] and metrics["height"] == metrics["vh"], metrics


def next_pages(reader, count=3):
    for _ in range(count):
        show_controls(reader)
        button = reader.locator("#next-chapter")
        if button.is_disabled():
            break
        before = reader.locator("#page-number").input_value() if reader.locator("#page-label").is_visible() else reader.locator("#chapter-status").text_content()
        button.click()
        reader.wait_for_function("""before => {
          const pdf = !document.getElementById('page-label').hidden;
          const current = pdf ? document.getElementById('page-number').value : document.getElementById('chapter-status').textContent;
          return current !== before;
        }""", arg=before)
        # The new content frame load / canvas render must finish before the next click.
        reader.wait_for_timeout(100)


def close_to_shelf(page, reader, book_path):
    show_controls(reader)
    reader.locator(".back-link").click()
    expect(page.locator(".reading-overlay")).to_have_count(0, timeout=5_000)
    page.wait_for_function("() => !document.fullscreenElement")
    assert page.evaluate("() => [...document.body.children].every(node => !node.inert)")
    assert page.evaluate("() => document.body.style.overflow") == ""
    expect(page.locator("#continue-reading")).to_be_visible()
    record = page.evaluate("path => JSON.parse(localStorage.getItem('fm-reading:' + path))", book_path)
    assert record and record.get("updatedAt"), f"Reading progress missing for {book_path}"
    page.wait_for_function("() => document.activeElement.matches('a[href], #book-search')", timeout=5_000)
    return record


def check_site(browser, origin, books, artifacts):
    context = browser.new_context(viewport={"width": 1280, "height": 900})
    # Test the site without any dependency on GitHub APIs or other external hosts.
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(origin + "/") or route.request.url.startswith(("blob:", "data:", "about:")) else route.abort())
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin + "/bookshelf.html")
    expect(page.locator("#book-grid")).to_have_attribute("aria-busy", "false")
    expect(page.locator(".book-card")).to_have_count(len(books))
    page.locator("#book-search").fill("no-matching-book-12345")
    expect(page.locator(".book-card")).to_have_count(0)
    expect(page.locator("#empty-shelf")).to_be_visible()
    page.locator("#empty-action").click()
    expect(page.locator(".book-card")).to_have_count(len(books))
    expect(page.locator("#book-search")).to_have_value("")

    tested = {}
    for fmt in FORMATS:
        page.select_option("#format-filter", fmt)
        card = page.locator(".book-card").first
        book_path = path_for(card)
        card.click()
        reader = wait_reader(page)
        page.wait_for_function("() => !!document.fullscreenElement")
        expect(reader.locator("#fullscreen-toggle")).to_have_attribute("aria-pressed", "true")
        check_full_page(reader)
        next_pages(reader)
        # Multiple chapter changes must not add inner history entries that consume
        # the shelf back action. One click should always dismiss the reader.
        tested[fmt] = (book_path, close_to_shelf(page, reader, book_path))
        print(f"PASS {fmt.upper()} fullscreen, chapter/page navigation, save and return", flush=True)

    page.select_option("#format-filter", "all")
    for status in ("unread", "reading", "finished"):
        page.locator(f'[data-reading-status="{status}"]').click()
        count = int(page.locator(f'[data-status-count="{status}"]').text_content())
        expect(page.locator(".book-card")).to_have_count(count)
    page.locator('[data-reading-status="all"]').click()
    page.select_option("#book-sort", "progress")
    percentages = [int(re.search(r"(\d+)%", text).group(1)) if "%" in text else 0
                   for text in page.locator(".book-reading-state").all_text_contents()]
    assert percentages == sorted(percentages, reverse=True)
    page.select_option("#book-sort", "recent")
    most_recent = max(tested.values(), key=lambda item: item[1]["updatedAt"])[0]
    assert path_for(page.locator(".book-card").first) == most_recent

    # A native browser Back and Forward must work after several chapters, too.
    page.select_option("#format-filter", "txt")
    page.locator(".book-card").first.click()
    reader = wait_reader(page)
    next_pages(reader)
    page.go_back()
    expect(page.locator(".reading-overlay")).to_have_count(0, timeout=5_000)
    page.go_forward()
    wait_reader(page)
    page.go_back()
    expect(page.locator(".reading-overlay")).to_have_count(0, timeout=5_000)
    print("PASS status filters, sort, browser Back/Forward", flush=True)

    # Ctrl-click retains the anchor's standard new-tab behavior.
    with context.expect_page() as new_page:
        page.locator(".book-card").first.click(modifiers=["Control"])
    opened = new_page.value
    opened.wait_for_load_state("domcontentloaded")
    assert "reader.html?book=" in opened.url
    expect(page.locator(".reading-overlay")).to_have_count(0)
    opened.close()

    # Browsers without Fullscreen API still get a viewport-filling reader.
    page.evaluate("() => { Element.prototype.requestFullscreen = undefined; Element.prototype.webkitRequestFullscreen = undefined; }")
    page.locator(".book-card").first.click()
    reader = wait_reader(page)
    assert not page.evaluate("() => !!document.fullscreenElement")
    bounds = page.locator(".reading-overlay").bounding_box()
    assert bounds["x"] == bounds["y"] == 0
    assert bounds["width"] == 1280 and bounds["height"] == 900
    check_full_page(reader)
    close_to_shelf(page, reader, tested["txt"][0])
    page.select_option("#format-filter", "all")
    for width in (390, 320):
        page.set_viewport_size({"width": width, "height": 844})
        page.locator("#my-books").scroll_into_view_if_needed()
        sizes = page.evaluate("() => ({scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth})")
        if artifacts:
            page.screenshot(path=str(artifacts / f"bookshelf-{width}.png"), full_page=True)
        assert sizes["scroll"] <= sizes["client"], f"Horizontal overflow at {width}px: {sizes}"
    assert not errors, errors
    print("PASS modified click, fullscreen fallback, phone layouts; no JavaScript errors", flush=True)
    context.close()



def check_pdf_compatibility(browser, origin, books):
    pdf_path = next(book["path"] for book in books if book["path"].lower().endswith(".pdf"))
    context = browser.new_context()
    context.add_init_script("Promise.withResolvers = undefined; Promise.try = undefined;")
    # init_script runs in documents, so remove the APIs from the worker separately.
    worker = "Promise.withResolvers = undefined; Promise.try = undefined;\n" + (ROOT / "vendor/pdfjs/pdf.worker.mjs").read_text()
    context.route("**/vendor/pdfjs/pdf.worker.mjs*", lambda route: route.fulfill(status=200, content_type="text/javascript", body=worker))
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(origin + "/reader.html?book=" + quote(pdf_path))
    expect(page.locator("#progress-status")).to_contain_text("%", timeout=60_000)
    canvas = page.locator("#pdf-canvas")
    assert canvas.evaluate("c => c.width > 0 && c.height > 0 && c.getContext('2d').getImageData(100, 100, 1, 1).data[3] > 0")
    total = int(page.locator("#page-total").text_content())
    target = min(7, total)
    page.evaluate("""target => {
      const input = document.getElementById('page-number');
      for (const page of [2, target, 1, target]) {
        input.value = page;
        input.dispatchEvent(new Event('change'));
      }
      for (let i = 0; i < 4; i++) document.getElementById('zoom-in').click();
    }""", target)
    expect(page.locator("#pdf-zoom")).to_have_text("200%", timeout=60_000)
    expect(canvas).to_have_attribute("aria-label", re.compile(f"第 {target} 页$"))
    assert canvas.evaluate("c => c.width * c.height <= 16 * 1024 * 1024")
    page.reload()
    expect(page.locator("#progress-status")).to_contain_text("%", timeout=60_000)
    expect(page.locator("#page-number")).to_have_value(str(target))
    assert not errors, errors
    print("PASS PDF without newer Promise APIs in page/worker, rapid navigation, zoom and resume", flush=True)
    context.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", default=os.environ.get("PLAYWRIGHT_CHROMIUM_EXECUTABLE") or shutil.which("chromium"))
    parser.add_argument("--artifacts-dir", type=Path)
    args = parser.parse_args()
    if args.artifacts_dir:
        args.artifacts_dir.mkdir(parents=True, exist_ok=True)
    with serve_site() as (origin, books), sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True, args=["--no-sandbox"])
        try:
            check_site(browser, origin, books, args.artifacts_dir)
            check_pdf_compatibility(browser, origin, books)
        finally:
            browser.close()


if __name__ == "__main__":
    main()
