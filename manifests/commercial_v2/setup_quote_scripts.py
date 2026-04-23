#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import socket
from typing import Any
from urllib import error as urlerror
from urllib import parse as urlparse
from urllib import request as urlrequest


ENTITY_ID = "entity.biz_quote_script"


def api_call(
    method: str,
    url: str,
    *,
    token: str | None = None,
    workspace_id: str | None = None,
    body: dict[str, Any] | None = None,
    timeout: int = 180,
    retries: int = 2,
) -> tuple[int, dict[str, Any]]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if workspace_id:
        headers["X-Workspace-Id"] = workspace_id
    data = json.dumps(body).encode("utf-8") if body is not None else None
    attempts = max(1, int(retries) + 1)
    for attempt in range(1, attempts + 1):
        req = urlrequest.Request(url, method=method, headers=headers, data=data)
        try:
            with urlrequest.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                payload = json.loads(raw.decode("utf-8")) if raw else {}
                return int(resp.status), payload if isinstance(payload, dict) else {}
        except urlerror.HTTPError as exc:
            raw = exc.read()
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except Exception:
                payload = {"ok": False, "errors": [{"message": raw.decode("utf-8", errors="replace")}]}
            return int(exc.code), payload if isinstance(payload, dict) else {}
        except (TimeoutError, socket.timeout, urlerror.URLError) as exc:
            if attempt >= attempts:
                raise RuntimeError(
                    f"request timeout after {attempts} attempt(s): {method} {url} ({exc})"
                ) from exc
            import time
            time.sleep(min(5, attempt))


def is_ok(payload: dict[str, Any]) -> bool:
    return bool(payload.get("ok") is True)


def collect_error_text(payload: dict[str, Any]) -> str:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return "Unknown error"
    parts: list[str] = []
    for entry in errors[:8]:
        if isinstance(entry, dict):
            code = entry.get("code")
            message = entry.get("message")
            path = entry.get("path")
            prefix = f"[{code}] " if isinstance(code, str) and code else ""
            suffix = f" ({path})" if isinstance(path, str) and path else ""
            parts.append(f"{prefix}{message or 'Error'}{suffix}")
        else:
            parts.append(str(entry))
    return "; ".join(parts)


def list_records(base_url: str, *, token: str | None, workspace_id: str | None) -> list[dict[str, Any]]:
    status, payload = api_call(
        "GET",
        f"{base_url}/records/{urlparse.quote(ENTITY_ID, safe='')}" + "?limit=200",
        token=token,
        workspace_id=workspace_id,
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"list quote scripts failed: {collect_error_text(payload)}")
    rows = payload.get("records")
    return [row for row in rows if isinstance(row, dict)] if isinstance(rows, list) else []


def create_record(base_url: str, record: dict[str, Any], *, token: str | None, workspace_id: str | None) -> dict[str, Any]:
    status, payload = api_call(
        "POST",
        f"{base_url}/records/{urlparse.quote(ENTITY_ID, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"create quote script '{record.get('biz_quote_script.script_name')}' failed: {collect_error_text(payload)}")
    created = payload.get("record")
    if not isinstance(created, dict):
        raise RuntimeError("create quote script failed: missing record payload")
    return created


def update_record(
    base_url: str,
    record_id: str,
    record: dict[str, Any],
    *,
    token: str | None,
    workspace_id: str | None,
) -> dict[str, Any]:
    status, payload = api_call(
        "PUT",
        f"{base_url}/records/{urlparse.quote(ENTITY_ID, safe='')}/{urlparse.quote(record_id, safe='')}",
        token=token,
        workspace_id=workspace_id,
        body={"record": record},
    )
    if status >= 400 or not is_ok(payload):
        raise RuntimeError(f"update quote script '{record.get('biz_quote_script.script_name')}' failed: {collect_error_text(payload)}")
    updated = payload.get("record")
    if not isinstance(updated, dict):
        raise RuntimeError("update quote script failed: missing record payload")
    return updated


def desired_scripts() -> list[dict[str, Any]]:
    return [
        {
            "biz_quote_script.script_name": "Joost Standard 3C NL",
            "biz_quote_script.language": "NL",
            "biz_quote_script.sales_entity": "NLight BV",
            "biz_quote_script.owner_name": "Joost Van Rooij",
            "biz_quote_script.template_name": "Standard 3C NL",
            "biz_quote_script.opening_message": (
                "NLight biedt u graag de volgende offerte aan voor dit LED-belichtingsproject. "
                "Zie hieronder de projectscope, voorwaarden en commerciële uitgangspunten."
            ),
            "biz_quote_script.body_text": """Verkoopcondities

Garantievoorwaarden:
- Garantie: 5 jaar of 36.000 uur, afhankelijk van wat eerst komt.
- Garantieperiode gaat in bij aflevering van de goederen.
- Spectrumbalans voor dit project: 88% rood, 6% groen, 6% blauw + 10% vermogensverdeling voor verrood.
- Voor dit project geldt L95B10 met 36.000 uur met maximaal 1% degradatie per jaar.
- Efficiëntie: 3,6 µmol/J op PAR (met 3,8 als alleen channel 1 gebruikt wordt).
- PPG Horticulture BV neemt de volledige garantie over van NLight.
- Bij uitval >2% zal NLight de vervanging regelen (materialen en arbeid).
- Voor volledige voorwaarden zie: www.n-light.tech

Leveringsomvang:
- Armaturen
- PSU voorzien van Wieland connector
- Bekabeling tussen armaturen en PSU
- Dongel voor dimfunctionaliteit
- Master gateway en benodigde gateway bridges
- Ophangbeugels voor armaturen en PSU's
- Installatiehandleiding

Offertes en lichtplannen:
- Deze offerte en eventuele bijbehorende tekeningen worden kosteloos en vrijblijvend verstrekt.
- Op basis van het geaccordeerde lichtplan geven wij 95% garantie op het behalen van de opgegeven waardes.

Leveringstermijn:
- Levertijd voor armaturen is 14 weken vanaf de aanbetaling tot aankomst in de haven van Rotterdam, te bevestigen bij bestelling.
- Indien goederen te laat in Rotterdam worden geleverd, wordt een korting van 1% per week toegepast, met uitzondering van overmacht.

Leveringsvoorwaarden:
- Leveringsconditie: DDP Nederland

Betalingscondities:
- 70% bij bestelling
- 20% uiterlijk 30 dagen vóór verzending
- 10% uiterlijk 30 dagen na aflevering
- Betaaltermijn: netto 7 dagen
- Betalingen dienen te worden voldaan aan een Nederlandse entiteit.
- Bij te late betaling behoudt NLight zich het recht voor 5% rente in rekening te brengen.

BTW & verwijderingsbijdrage:
- Alle prijzen zijn exclusief BTW en exclusief de wettelijke verwijderingsbijdrage.
- Deze worden separaat op de factuur vermeld.

Verzekering:
- Na levering op locatie is de klant zelf verantwoordelijk voor alle benodigde verzekeringen van de materialen.""",
            "biz_quote_script.transport_disclaimer": """Disclaimer – Transportkosten en toeslagen

Als gevolg van de huidige geopolitieke ontwikkelingen, kunnen transportkosten onderhevig zijn aan plotselinge en significante wijzigingen. Wij behouden ons het recht voor om eventuele extra kosten, waaronder maar niet beperkt tot oorlogstoeslagen, brandstoftoeslagen, omleidingskosten, verzekeringspremies en andere door vervoerders opgelegde toeslagen, door te belasten aan de opdrachtgever indien en voor zover deze kosten na offerte- of orderbevestiging ontstaan of worden verhoogd.

Deze kosten zijn buiten onze invloed en controle en worden door externe partijen bepaald. Eventuele vertragingen, routewijzigingen of aanvullende maatregelen voortvloeiend uit deze situatie vallen onder overmacht en kunnen geen grond vormen voor aansprakelijkheid of schadevergoeding. Wij zullen u zo tijdig mogelijk informeren over relevante wijzigingen.""",
            "biz_quote_script.closing_text": (
                "Door deze offerte te accepteren, gaat de klant ermee akkoord gebonden te zijn aan de Verkoopvoorwaarden van NLight B.V., "
                "beschikbaar op www.n-light.tech.\n\nWij hopen dat dit aanbod aansluit bij de projectdoelstellingen. "
                "Laat het gerust weten als aantallen, scope, planning of commerciële voorwaarden aangepast moeten worden."
            ),
            "biz_quote_script.is_active": True,
        },
        {
            "biz_quote_script.script_name": "Joram Base Script",
            "biz_quote_script.language": "EN",
            "biz_quote_script.sales_entity": "NLight BV",
            "biz_quote_script.owner_name": "Joram Wijnaendts van Resandt",
            "biz_quote_script.template_name": "Base Script EN",
            "biz_quote_script.opening_message": (
                "Thank you for the opportunity to quote for this LED lighting project.\n\n"
                "Please find below the scope, conditions, and commercial terms that apply to this proposal."
            ),
            "biz_quote_script.body_text": """Why Choose NLight
As part of the PPG Projects group, NLight combines horticultural lighting technology with the backing of an established UK and European engineering specialist delivering integrated turnkey solutions. Customers can work with Power Plus Group installation teams or their own preferred installer.

At NLight, we are committed to advancing controlled environment agriculture and commercial cultivation with solutions that deliver measurable impact:
- Precision engineering tested in real-world horticultural and laboratory environments
- Spectral customisation tailored to the specific needs of each project
- Proven performance with verified efficiency up to 4.1 µmol/J
- Intelligent control with dimming functionality and remote gateway access
- Sustainable and compliant fittings backed by warranties and long-term support
- A partnership approach from design through implementation and optimisation

Sales & Warranty Conditions
- 5-year warranty or 36,000 operational hours, whichever comes first
- Warranty commences from the date of delivery
- Spectrum configuration: 88% red, 6% green, 6% blue + 10% far red
- L95B10 performance with maximum 1% degradation per year
- Photosynthetic efficiency: 3.9 µmol/J PAR (up to 4.1 µmol/J on Channel 1 only)
- Minimum guaranteed performance of 95% of specified light output, efficiency, and mechanical values
- If failure rate exceeds 2%, NLight will arrange replacement of both materials and labour
- Full warranty support is transferred to PPG Horticulture BV
- Full terms: www.n-light.tech

Scope of Delivery
- LED luminaires
- PSUs with integrated Wieland connectors
- Interconnecting cabling
- Dimming control dongle
- Master gateway with required gateway bridges
- Mounting brackets for luminaires and PSUs
- DDP to customer site
- Installation manual and user documentation

Quotations and Lighting Design
- All quotations and accompanying lighting designs are provided free of charge and without obligation
- Upon approval of the final lighting plan, NLight guarantees at least 95% compliance with stated performance metrics

Delivery Timeline
- Estimated lead time is 14 weeks from receipt of initial down payment to arrival at Port of Rotterdam
- Delivery dates are confirmed upon order placement
- For late deliveries, excluding force majeure, NLight offers a 1% discount per week of delay applied to the total investment value

Pricing & VAT
- All prices are exclusive of VAT
- The statutory disposal contribution is excluded and itemised separately on the final invoice

Delivery & Payment Terms
- Incoterms: DDP Macedonia
- 70% due upon order placement
- 20% due no later than 30 days prior to delivery at Port of Rotterdam
- 10% due no later than 30 days post-delivery
- Payment terms: net 7 days
- Payments must be made to a Dutch-registered entity
- Late payments may incur 5% interest above the prevailing government base rate
- Goods may be held until payments are fulfilled, with storage fees applying
- Failure to settle invoices within 30 days may result in cancellation and forfeiture of deposits

Insurance & Risk Transfer
- Once materials have been delivered to the project location, insurance responsibilities transfer to the client.""",
            "biz_quote_script.transport_disclaimer": """Disclaimer – Transport Costs and Surcharges

As a result of current geopolitical developments, transport costs may be subject to sudden and significant changes. We reserve the right to pass on additional costs, including war risk surcharges, fuel surcharges, rerouting costs, insurance premiums, and any other carrier-imposed surcharges, insofar as those costs arise or increase after quotation or order confirmation.

These costs are outside our influence and control and are determined by third parties such as shipping lines, airlines, and logistics providers. Any delays, route changes, or additional measures resulting from this situation are considered force majeure and do not constitute grounds for liability or compensation.""",
            "biz_quote_script.closing_text": (
                "By accepting this quotation, the Customer agrees to be bound by NLight B.V.'s Terms and Conditions of Sale, available at www.n-light.tech.\n\n"
                "We trust that this proposal provides a clear basis for the next step. Please let us know if you would like us to revise quantities, scope assumptions, delivery timing, or commercial terms."
            ),
            "biz_quote_script.is_active": True,
        },
        {
            "biz_quote_script.script_name": "NLight Standard Base Script EN",
            "biz_quote_script.language": "EN",
            "biz_quote_script.sales_entity": "NLight BV",
            "biz_quote_script.owner_name": "Shared",
            "biz_quote_script.template_name": "Standard Base Script EN",
            "biz_quote_script.opening_message": (
                "NLight is pleased to submit this quotation for the supply of high-efficiency LED lighting in line with your project requirements.\n\n"
                "Please find below the scope, conditions, and commercial terms applicable to this offer."
            ),
            "biz_quote_script.body_text": """Why Choose NLight
NLight is a leading innovator in advanced LED lighting systems tailored for controlled environments, with a strong focus on horticulture, research, and commercial cultivation. Clients across Europe and the Middle East trust us for:
- Precision engineering tested in real-world horticultural and laboratory environments
- Spectral customisation for the unique needs of each project
- Trusted performance with verified efficiency up to 4.0 µmol/J
- Intelligent control through dimming and remote gateway access
- Sustainable, compliant fittings backed by comprehensive warranty and support
- A partnership approach from design through implementation and beyond

Sales & Warranty Conditions
- 5-year warranty or 36,000 operational hours, whichever comes first
- Warranty commences from date of delivery
- Spectrum configuration: 88% red, 6% green, 6% blue, with 10% power allocated to far-red
- L95B10 light output with maximum degradation of 1% per year
- Photosynthetic efficiency: 3.6 µmol/J PAR (up to 3.8 µmol/J on Channel 1 only)
- Minimum guaranteed performance of 95% of specified light output, efficiency, and mechanical values
- If failure rate exceeds 2%, NLight will arrange replacement of materials and labour
- Full warranty responsibilities are transferred to NLight BV
- Full terms: www.n-light.tech

Scope of Delivery
- LED luminaires
- Power Supply Units with integrated Wieland connectors
- Interconnecting cabling between luminaires and PSUs
- Dimming control dongle
- Master gateway with required gateway bridges
- Mounting brackets for luminaires and PSUs
- Installation manual and user documentation

Quotations and Lighting Design
- All quotations and accompanying lighting designs are provided free of charge and without obligation
- Upon approval of the final lighting plan, NLight guarantees at least 95% compliance with stated performance metrics

Delivery Timeline
- Estimated lead time is 14 weeks from receipt of initial down payment to arrival at Port of Rotterdam
- Delivery dates are confirmed upon order placement
- For late deliveries, excluding force majeure, NLight offers a 1% discount per week of delay applied to the total investment value

Pricing & VAT
- All prices are exclusive of VAT
- The statutory disposal contribution is excluded and itemised separately on the final invoice

Delivery & Payment Terms
- Delivery terms: DDP Netherlands
- 70% due upon order placement
- 20% due no later than 30 days prior to delivery at Port of Rotterdam
- 10% due no later than 30 days post-delivery
- Payment terms: net 7 days
- Payments must be made to a Dutch-registered entity
- NLight reserves the right to charge 5% interest above the prevailing government base rate for delayed payment
- Goods may be held until payments are fulfilled, with storage fees applying
- Failure to settle invoices within 30 days may result in cancellation and forfeiture of deposits

Insurance & Risk Transfer
- Once materials have been delivered to the project location, insurance responsibilities transfer to the client.""",
            "biz_quote_script.transport_disclaimer": """Disclaimer – Transport Costs and Surcharges

As a result of current geopolitical developments, transport costs may be subject to sudden and significant changes. We reserve the right to pass on additional costs, including war risk surcharges, fuel surcharges, rerouting costs, insurance premiums, and any other carrier-imposed surcharges, insofar as those costs arise or increase after quotation or order confirmation.

These costs are outside our influence and control and are determined by third parties such as shipping lines, airlines, and logistics providers. Any delays, route changes, or additional measures resulting from this situation are considered force majeure and do not constitute grounds for liability or compensation.""",
            "biz_quote_script.closing_text": (
                "By accepting this quotation, the Customer agrees to be bound by NLight B.V.'s Terms and Conditions of Sale, available at www.n-light.tech.\n\n"
                "We trust that this proposal aligns with your expectations and project goals. Please let us know if you would like us to adjust scope, quantities, delivery assumptions, or commercial terms before proceeding."
            ),
            "biz_quote_script.is_active": True,
        },
        {
            "biz_quote_script.script_name": "Standard Without Extras NL",
            "biz_quote_script.language": "NL",
            "biz_quote_script.sales_entity": "NLight BV",
            "biz_quote_script.owner_name": "Shared",
            "biz_quote_script.template_name": "Standard Without Extras NL",
            "biz_quote_script.opening_message": (
                "NLight biedt u graag de volgende offerte aan voor dit LED-belichtingsproject. "
                "Zie hieronder de projectscope en de bijbehorende voorwaarden."
            ),
            "biz_quote_script.body_text": """Verkoopcondities

Garantievoorwaarden:
- Garantie: 5 jaar of 36.000 uur, afhankelijk van wat eerst komt.
- Garantieperiode gaat in bij aflevering van de goederen.
- Spectrumbalans voor dit project: 88% rood, 6% groen, 6% blauw + 10% vermogensverdeling voor verrood.
- Voor dit project geldt L95B10 met 36.000 uur met maximaal 1% degradatie per jaar.
- Efficiëntie: 3,8 µmol/J op PAR (met 4,0 als alleen channel 1 gebruikt wordt).
- Voor volledige voorwaarden zie: www.n-light.tech

Leveringsomvang:
- Armaturen
- PSU voorzien van Wieland connector
- Bekabeling tussen armaturen en PSU
- Dongel voor dimfunctionaliteit
- Master gateway en benodigde gateway bridges
- Ophangbeugels voor armaturen en PSU's
- Installatiehandleiding

Offertes en lichtplannen:
- Deze offerte en eventuele bijbehorende tekeningen worden kosteloos en vrijblijvend verstrekt.
- Op basis van het geaccordeerde lichtplan geven wij 95% garantie op het behalen van de opgegeven waardes.

Leveringstermijn:
- Levertijd voor armaturen is 16 weken vanaf de aanbetaling tot aankomst in de haven van Rotterdam, te bevestigen bij bestelling.
- Prijzen zijn berekend exclusief BTW en verwijderingsbijdrage.

Leveringsvoorwaarden:
- Leveringsconditie: DDP Nederland

Betalingscondities:
- 70% bij bestelling
- 20% uiterlijk 30 dagen vóór verzending
- 10% uiterlijk 30 dagen na aflevering
- Betaaltermijn: netto 7 dagen
- Betalingen dienen te worden voldaan aan een Nederlandse entiteit.

BTW & verwijderingsbijdrage:
- Alle prijzen zijn exclusief BTW en exclusief de wettelijke verwijderingsbijdrage.
- Deze worden separaat op de factuur vermeld.

Verzekering:
- Na levering op locatie is de klant zelf verantwoordelijk voor alle benodigde verzekeringen van de materialen.""",
            "biz_quote_script.transport_disclaimer": """Disclaimer – Transportkosten en toeslagen

Als gevolg van de huidige geopolitieke ontwikkelingen, kunnen transportkosten onderhevig zijn aan plotselinge en significante wijzigingen. Wij behouden ons het recht voor om eventuele extra kosten, waaronder maar niet beperkt tot oorlogstoeslagen, brandstoftoeslagen, omleidingskosten, verzekeringspremies en andere door vervoerders opgelegde toeslagen, door te belasten aan de opdrachtgever indien en voor zover deze kosten na offerte- of orderbevestiging ontstaan of worden verhoogd.

Deze kosten zijn buiten onze invloed en controle en worden door externe partijen bepaald. Eventuele vertragingen, routewijzigingen of aanvullende maatregelen voortvloeiend uit deze situatie vallen onder overmacht en kunnen geen grond vormen voor aansprakelijkheid of schadevergoeding. Wij zullen u zo tijdig mogelijk informeren over relevante wijzigingen.""",
            "biz_quote_script.closing_text": (
                "Door deze offerte te accepteren, gaat de klant ermee akkoord gebonden te zijn aan de Verkoopvoorwaarden van NLight B.V., beschikbaar op www.n-light.tech.\n\n"
                "Wij hopen dat dit aanbod een goede basis vormt voor de volgende stap. Laat het gerust weten als aantallen, scope, planning of commerciële voorwaarden aangepast moeten worden."
            ),
            "biz_quote_script.is_active": True,
        },
    ]


def script_key(record: dict[str, Any]) -> tuple[str, str, str]:
    return (
        str(record.get("biz_quote_script.script_name") or "").strip().lower(),
        str(record.get("biz_quote_script.language") or "").strip().upper(),
        str(record.get("biz_quote_script.sales_entity") or "").strip(),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update the standard NLight quote scripts.")
    parser.add_argument("--base-url", default=None, help="API base URL, e.g. https://app.octodrop.com")
    parser.add_argument("--token", default=None, help="Bearer token")
    parser.add_argument("--workspace-id", default=None, help="Workspace ID")
    args = parser.parse_args()

    base_url = (args.base_url or os.environ.get("OCTO_BASE_URL", "")).strip().rstrip("/")
    token = (args.token or os.environ.get("OCTO_API_TOKEN", "")).strip() or None
    workspace_id = (args.workspace_id or os.environ.get("OCTO_WORKSPACE_ID", "")).strip() or None
    if not base_url:
        raise SystemExit("--base-url or OCTO_BASE_URL is required")

    existing = list_records(base_url, token=token, workspace_id=workspace_id)
    existing_by_key: dict[tuple[str, str, str], dict[str, Any]] = {}
    for item in existing:
        record = item.get("record") if isinstance(item, dict) else None
        if not isinstance(record, dict):
            continue
        key = script_key(record)
        if key[0]:
            existing_by_key[key] = {
                "record_id": item.get("record_id") or record.get("id"),
                "record": record,
            }

    for spec in desired_scripts():
        key = script_key(spec)
        existing_item = existing_by_key.get(key)
        label = spec.get("biz_quote_script.script_name")
        if isinstance(existing_item, dict) and isinstance(existing_item.get("record_id"), str) and existing_item.get("record_id"):
            update_record(
                base_url,
                str(existing_item["record_id"]),
                spec,
                token=token,
                workspace_id=workspace_id,
            )
            print(f"[quote-scripts] updated {label}")
        else:
            create_record(
                base_url,
                spec,
                token=token,
                workspace_id=workspace_id,
            )
            print(f"[quote-scripts] created {label}")


if __name__ == "__main__":
    main()
