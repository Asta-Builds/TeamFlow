import os
import stat
import unittest

from teamflow_cli.config import Session, normalize_url
from teamflow_cli.errors import CliError

from .support import temp_store


class NormalizeUrlTests(unittest.TestCase):
    def test_strips_trailing_slash_and_api_suffix(self):
        self.assertEqual(normalize_url("https://tf.example.com/"), "https://tf.example.com")
        self.assertEqual(normalize_url("https://tf.example.com/api/"), "https://tf.example.com")
        self.assertEqual(normalize_url(" http://localhost:8001 "), "http://localhost:8001")

    def test_requires_http_scheme(self):
        with self.assertRaises(CliError):
            normalize_url("tf.example.com")


class HostStoreTests(unittest.TestCase):
    def test_saves_one_session_per_server(self):
        store = temp_store(self)
        store.save_session("https://a.example", Session("a1", "r1", "a@example.com"), make_current=True)
        store.save_session("https://b.example", Session("b1", "r2"), make_current=False)

        self.assertEqual(store.current_url(), "https://a.example")
        self.assertEqual(store.session("https://a.example"), Session("a1", "r1", "a@example.com"))
        self.assertEqual(store.session("https://b.example").access, "b1")
        self.assertIsNone(store.session("https://c.example"))

    def test_clearing_a_session_keeps_the_others(self):
        store = temp_store(self)
        store.save_session("https://a.example", Session("a1", "r1"), make_current=True)
        store.save_session("https://b.example", Session("b1", "r2"), make_current=False)

        store.clear_session("https://a.example")

        self.assertIsNone(store.session("https://a.example"))
        self.assertIsNotNone(store.session("https://b.example"))

    def test_empty_store(self):
        store = temp_store(self)
        self.assertIsNone(store.current_url())
        self.assertIsNone(store.session("https://a.example"))
        store.clear_session("https://a.example")  # Nothing to clear is not an error.

    @unittest.skipIf(os.name == "nt", "POSIX file modes")
    def test_tokens_are_readable_by_the_owner_only(self):
        store = temp_store(self)
        store.save_session("https://a.example", Session("a1", "r1"), make_current=True)
        self.assertEqual(stat.S_IMODE(os.stat(store.path).st_mode), 0o600)

    def test_unreadable_file_is_reported(self):
        store = temp_store(self)
        store.directory.mkdir(parents=True, exist_ok=True)
        store.path.write_text("{not json", encoding="utf-8")
        with self.assertRaises(CliError):
            store.session("https://a.example")
