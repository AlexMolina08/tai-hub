from datetime import date
import json
import unittest
from unittest.mock import patch

from check_inap import boe_notices, changes, parse_detail, parse_portal, read_inap


portal_html = """
<a href="https://sede.inap.gob.es/navegacion">Otro cuerpo</a>
<h2 class="title__section">Convocatoria 2026</h2>
<a class="card-link-noIcon" href="https://sede.inap.gob.es/tai-2026"><p>Ingreso libre</p></a>
<a class="card-link-noIcon" href="https://evil.example/2026">Suplantación</a>
<h2 class="title__section">Convocatoria 2025</h2>
<a class="card-link-noIcon" href="https://sede.inap.gob.es/tai-2025">Ingreso libre</a>
<h2 class="title__section">Exámenes Ingreso libre</h2>
<a class="card-link-noIcon" href="/examen.pdf">Cuestionario</a>
"""

detail_html = """
<div><a href="https://sede.inap.gob.es/otra-oposicion">Otra oposición</a></div>
<div class="inap__richText">
  <h3>Convocatoria</h3><a href="/bases.pdf">Bases &amp; temario</a>
  <h3>Ejercicio único</h3><a href="/a.pdf">Modelo A</a>
  <a href="javascript:alert(1)">Inseguro</a>
  <div><a href="/b.pdf">Modelo B</a></div>
</div>
<a href="https://sede.inap.gob.es/privacidad">Privacidad</a>
"""


class InapTests(unittest.TestCase):
    def test_reads_only_call_and_exam_links_from_portal(self):
        calls, resources = parse_portal(portal_html)
        self.assertEqual([(call["year"], call["label"]) for call in calls],
                         [(2026, "Ingreso libre"), (2025, "Ingreso libre")])
        self.assertEqual(resources[0]["links"][0]["url"], "https://www.inap.es/examen.pdf")
        with self.assertRaises(ValueError):
            parse_portal("<h1>En mantenimiento</h1>")

    def test_reads_only_scoped_links_from_process_page(self):
        parsed = parse_detail(detail_html, "https://sede.inap.gob.es/tai-2026")
        self.assertEqual([(group["title"], [link["label"] for link in group["links"]])
                          for group in parsed["sections"]],
                         [("Convocatoria", ["Bases & temario"]),
                          ("Ejercicio único", ["Modelo A", "Modelo B"])])

    def test_updates_alert_sequence_only_on_content_changes(self):
        calls, resources = parse_portal(portal_html)
        latest, prior = calls
        prior.update(parse_detail(detail_html, prior["url"]))
        old = {"calls": [prior], "resources": resources, "boe": [], "sequence": 7, "changes": []}
        self.assertEqual(changes(old, old, "2026-11-06T00:00:00Z"), (7, []))
        changed = {**prior, **parse_detail(detail_html.replace("/a.pdf", "/a-v2.pdf"), prior["url"])}
        current = {**old, "calls": [latest, changed]}
        sequence, events = changes(old, current, "2026-11-06T01:00:00Z")
        self.assertEqual(sequence, 9)
        self.assertTrue(events[1]["label"].startswith("Nueva ficha INAP · 2026"))
        self.assertTrue(events[0]["label"].startswith("Ficha INAP actualizada · 2025"))

    def test_keeps_previous_detail_on_fetch_failure(self):
        calls, resources = parse_portal(portal_html)
        for call in calls:
            call.update(parse_detail(detail_html, call["url"]))
        previous = {"calls": calls, "resources": resources, "inapCheckedAt": "2026-11-06T00:00:00Z"}

        def retrieve(url, _accept="text/html"):
            if "www.inap.es" in url:
                return portal_html, url
            if url.endswith("tai-2026"):
                raise OSError("Sede temporalmente caída")
            return detail_html, url

        with patch("check_inap.fetch", side_effect=retrieve):
            result = read_inap(previous, "2026-11-06T01:00:00Z")
        self.assertEqual(result["calls"], calls)
        self.assertNotIn("inapCheckedAt", result)

    def test_verifies_tai_in_the_full_consolidated_boe_call(self):
        notice = {
            "identificador": "BOE-A-2026-42",
            "titulo": "Resolución por la que se convocan procesos selectivos en Cuerpos de la Administración General del Estado",
            "url_html": "https://www.boe.es/diario_boe/txt.php?id=BOE-A-2026-42",
            "url_xml": "https://www.boe.es/diario_boe/xml.php?id=BOE-A-2026-42",
        }
        summary = {"data": {"sumario": {"diario": {"seccion": {
            "codigo": "2B", "departamento": {"epigrafe": {"item": notice}},
        }}}}}
        matching = "<text>Cuerpo de Técnicos Auxiliares de Informática de la Administración del Estado (ingreso libre)</text>"
        with patch("check_inap.fetch", side_effect=[(json.dumps(summary), ""), (matching, "")]):
            self.assertEqual(boe_notices(date(2026, 11, 6))[0]["kind"], "call")
        with patch("check_inap.fetch", side_effect=[(json.dumps(summary), ""), ("<text>Otro cuerpo</text>", "")]):
            self.assertEqual(boe_notices(date(2026, 11, 6)), [])
