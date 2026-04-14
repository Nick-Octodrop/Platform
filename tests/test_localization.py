import unittest

from app.localization import (
    DEFAULT_CURRENCY,
    DEFAULT_LOCALE,
    DEFAULT_TIMEZONE,
    build_locale_context,
    resolve_currency_for_field,
    resolve_default_currency,
    resolve_locale,
    resolve_timezone,
)


class LocalizationResolutionTests(unittest.TestCase):
    def test_locale_resolution_prefers_user_then_workspace_then_default(self):
        self.assertEqual(resolve_locale("fr-FR", "en-NZ"), "fr-FR")
        self.assertEqual(resolve_locale(None, "en-US"), "en-US")
        self.assertEqual(resolve_locale(None, None), DEFAULT_LOCALE)

    def test_timezone_resolution_prefers_user_then_workspace_then_default(self):
        self.assertEqual(resolve_timezone("Europe/Amsterdam", "Pacific/Auckland"), "Europe/Amsterdam")
        self.assertEqual(resolve_timezone(None, "Pacific/Auckland"), "Pacific/Auckland")
        self.assertEqual(resolve_timezone(None, None), DEFAULT_TIMEZONE)

    def test_build_locale_context_includes_workspace_fallbacks(self):
        context = build_locale_context(
            workspace={"default_locale": "en-US", "default_timezone": "Pacific/Auckland", "default_currency": "USD"},
            user={"locale": None, "timezone": None},
        )
        self.assertEqual(context["locale"], "en-US")
        self.assertEqual(context["timezone"], "Pacific/Auckland")
        self.assertEqual(context["default_currency"], "USD")

    def test_workspace_default_currency_falls_back_safely(self):
        self.assertEqual(resolve_default_currency("EUR"), "EUR")
        self.assertEqual(resolve_default_currency(None), DEFAULT_CURRENCY)

    def test_currency_resolution_order_prefers_explicit_then_record_then_workspace(self):
        explicit = {"type": "currency", "currency_code": "EUR"}
        record_driven = {"type": "currency", "currency_field": "invoice.currency_code"}
        workspace_driven = {"type": "currency", "currency_source": "workspace_default"}

        self.assertEqual(resolve_currency_for_field(explicit, {"invoice.currency_code": "USD"}, "NZD"), "EUR")
        self.assertEqual(resolve_currency_for_field(record_driven, {"invoice.currency_code": "USD"}, "NZD"), "USD")
        self.assertEqual(resolve_currency_for_field(workspace_driven, {}, "AUD"), "AUD")
        self.assertEqual(resolve_currency_for_field({"type": "currency"}, {}, None), DEFAULT_CURRENCY)

    def test_legacy_number_currency_format_still_resolves(self):
        legacy_field = {
            "type": "number",
            "format": {
                "kind": "currency",
                "currency_field": "invoice.currency_code",
            },
        }
        self.assertEqual(resolve_currency_for_field(legacy_field, {"invoice.currency_code": "GBP"}, "NZD"), "GBP")


if __name__ == "__main__":
    unittest.main()
