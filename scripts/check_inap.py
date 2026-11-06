"""Collect links and changes from the public INAP pages and the BOE summary API."""

from argparse import ArgumentParser
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
from unicodedata import normalize
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from zoneinfo import ZoneInfo

PORTAL = "https://www.inap.es/es/seleccion/procesos-selectivos-de-cuerposescalas-generales/cuerpo-de-tecnicos-auxiliares-de-informatica-de-la-administracion-del-estado"
BOE_SUMMARY = "https://www.boe.es/datosabiertos/api/boe/sumario/"
HOSTS = {"www.inap.es", "inap.es", "sede.inap.gob.es", "www.boe.es", "boe.es",
         "ips.redsara.es", "administracion.gob.es"}
TAI = "cuerpo de tecnicos auxiliares de informatica de la administracion del estado"
CAP = 3_000_000


def official_url(value, base):
    url = urlsplit(urljoin(base, value))
    if url.scheme != "https" or url.netloc not in HOSTS or len(url.geturl()) > 1600:
        return None
    return urlunsplit(url._replace(fragment=""))


class OfficialRedirects(HTTPRedirectHandler):
    max_redirections = 4

    def redirect_request(self, request, stream, code, message, headers, destination):
        if not official_url(destination, request.full_url):
            raise ValueError("Redirección fuera de las fuentes oficiales")
        return super().redirect_request(request, stream, code, message, headers, destination)


def fetch(url, accept="text/html"):
    if not official_url(url, url):
        raise ValueError("Fuente fuera de la lista oficial")
    request = Request(url, headers={"Accept": accept, "User-Agent": "TAI Hub (enlaces oficiales)"})
    with build_opener(OfficialRedirects()).open(request, timeout=15) as response:
        body = response.read(CAP + 1)
        if len(body) > CAP:
            raise ValueError("Respuesta oficial demasiado grande")
        return body.decode("utf-8"), response.geturl()


def clean(value):
    return " ".join(value.split())


def fold(value):
    return "".join(char for char in normalize("NFD", clean(value).lower())
                   if not "\u0300" <= char <= "\u036f")


class OfficialHTML(HTMLParser):
    def __init__(self, base, *, portal=False):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.portal = portal
        self.depth = 0
        self.anchor = None
        self.heading = None
        self.sections = {}
        self.section = "Documentos"
        self.words = []

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        classes = (attrs.get("class") or "").split()
        if tag == "div" and (self.depth or "inap__richText" in classes):
            self.depth += 1
        if not self.portal and not self.depth:
            return
        if tag in {"h2", "h3", "h4"} and (not self.portal or "title__section" in classes):
            self.heading = (tag, [])
        if tag == "a" and attrs.get("href") and (not self.portal or "card-link-noIcon" in classes):
            url = official_url(attrs["href"], self.base)
            if url:
                self.anchor = (url, [])

    def handle_endtag(self, tag):
        if tag == "div" and self.depth:
            self.depth -= 1
        if self.heading and tag == self.heading[0]:
            self.section = clean("".join(self.heading[1]))[:160] or "Documentos"
            self.heading = None
        if tag == "a" and self.anchor:
            url, words = self.anchor
            label = clean("".join(words))[:200]
            if label and not (self.portal and self.section == "Documentos"):
                self.sections.setdefault(self.section, {})[(url, label)] = {"label": label, "url": url}
            self.anchor = None

    def handle_data(self, value):
        if self.heading:
            self.heading[1].append(value)
        if self.anchor:
            self.anchor[1].append(value)
        if self.depth and clean(value):
            self.words.append(clean(value))

    def groups(self):
        return [{"title": title, "links": list(links.values())}
                for title, links in self.sections.items()]


def parse_portal(html, base=PORTAL):
    parser = OfficialHTML(base, portal=True)
    parser.feed(html)
    calls, resources = [], []
    for group in parser.groups():
        year = re.match(r"Convocatoria (20\d{2})\b", group["title"], re.I)
        if year:
            for link in group["links"]:
                if urlsplit(link["url"]).hostname == "sede.inap.gob.es":
                    calls.append({"year": int(year[1]), **link})
        elif fold(group["title"]).startswith("examenes"):
            resources.append(group)
    if not calls or not any("libre" in fold(call["label"]) for call in calls):
        raise ValueError("El portal INAP ya no presenta convocatorias con el formato esperado")
    return sorted(calls, key=lambda call: -call["year"])[:20], resources


def parse_detail(html, url):
    parser = OfficialHTML(url)
    parser.feed(html)
    if not parser.sections or not parser.words:
        raise ValueError("La ficha INAP ya no presenta documentos con el formato esperado")
    return {"sections": parser.groups(), "fingerprint": sha256(" ".join(parser.words).encode()).hexdigest()}


def read_inap(previous, checked_at):
    html, url = fetch(PORTAL)
    calls, resources = parse_portal(html, url)
    old = {call["url"]: call for call in previous.get("calls", [])}

    def read_call(call):
        try:
            content, source = fetch(call["url"])
            return {**call, **parse_detail(content, source)}, True
        except (OSError, ValueError) as error:
            print(f"Ficha INAP {call['year']} {call['label']}: {error}")
            return {**old.get(call["url"], {"sections": [], "fingerprint": ""}), **call}, False

    with ThreadPoolExecutor(max_workers=3) as pool:
        details = list(pool.map(read_call, calls))
    result = {"calls": [call for call, _ in details], "resources": resources}
    if all(ok for _, ok in details):
        result["inapCheckedAt"] = checked_at
    return result


def items(value):
    return value if isinstance(value, list) else [value] if isinstance(value, dict) else []


def boe_candidates(summary):
    for issue in items(summary["data"]["sumario"]["diario"]):
        for section in items(issue.get("seccion")):
            if section.get("codigo") not in {"2A", "2B"}:
                continue
            for department in items(section.get("departamento")):
                for group in items(department.get("epigrafe")):
                    for item in items(group.get("item")):
                        title = fold(item.get("titulo", ""))
                        call = re.search(r"\bconvocan?\b", title) and "proceso" in title
                        general = "cuerpos" in title and "administracion general del estado" in title
                        if TAI in title or (call and general):
                            yield item, bool(call), TAI not in title


def boe_notices(day):
    try:
        raw, _ = fetch(BOE_SUMMARY + day.strftime("%Y%m%d"), "application/json")
    except HTTPError as error:
        if error.code == 404:
            return []
        raise

    notices = []
    for item, is_call, generic in boe_candidates(json.loads(raw)):
        url = official_url(item.get("url_html") or "#", BOE_SUMMARY)
        identifier = item.get("identificador", "")
        if not url or not re.fullmatch(r"BOE-A-\d{4}-\d+", identifier) or identifier not in url:
            continue
        if generic or is_call:
            xml = item.get("url_xml", "")
            if not xml:
                continue
            document, _ = fetch(xml, "application/xml")
            body = fold(re.sub(r"<[^>]+>", " ", document))
            if TAI not in body:
                continue
            if is_call:
                is_call = bool(re.search(re.escape(TAI) + r"[^.]{0,120}ingreso libre", body))
        notices.append({"id": identifier, "label": clean(item["titulo"])[:350], "url": url,
                        "date": day.isoformat(), "kind": "call" if is_call else "notice"})
    return notices


def read_boe(previous, today):
    last = date.fromisoformat(previous.get("boeThrough") or (today - timedelta(days=10)).isoformat())
    first = min(last - timedelta(days=2), today - timedelta(days=2))
    through = min(first + timedelta(days=20), today)
    days = (first + timedelta(days=index) for index in range((through - first).days + 1))
    known = {entry["id"]: entry for entry in previous.get("boe", [])}
    with ThreadPoolExecutor(max_workers=2) as pool:
        for notices in pool.map(boe_notices, days):
            known.update((notice["id"], notice) for notice in notices)
    return {"boe": sorted(known.values(), key=lambda notice: notice["date"], reverse=True)[:45],
            "boeThrough": through.isoformat()}


def link_set(call):
    return {(group["title"], link["url"], link["label"])
            for group in call.get("sections", []) for link in group["links"]}


def changes(previous, current, checked_at):
    events = []
    old_calls = {call["url"]: call for call in previous.get("calls", [])}
    current_calls = {call["url"]: call for call in current["calls"]}
    for url, call in current_calls.items():
        old = old_calls.get(url)
        label = f"{call['year']} · {call['label']}"
        if old is None:
            events.append({"label": f"Nueva ficha INAP · {label}", "url": url})
        elif (old["label"], old["year"], old.get("fingerprint"), link_set(old)) != (
                call["label"], call["year"], call.get("fingerprint"), link_set(call)):
            added = link_set(call) - link_set(old)
            removed = link_set(old) - link_set(call)
            details = [label for _, _, label in sorted(added)][:3]
            if removed:
                details.append(f"{len(removed)} enlaces retirados o sustituidos")
            events.append({"label": f"Ficha INAP actualizada · {label}", "url": url,
                           "detail": " · ".join(details)})
    for url in old_calls.keys() - current_calls.keys():
        old = old_calls[url]
        events.append({"label": f"Ficha retirada del índice INAP · {old['year']} · {old['label']}",
                       "url": PORTAL})
    if current["resources"] != previous.get("resources", []):
        events.append({"label": "Recursos de examen actualizados en INAP", "url": PORTAL})
    seen_boe = {item["id"] for item in previous.get("boe", [])}
    for item in current["boe"]:
        if item["id"] not in seen_boe:
            events.append({"label": "Convocatoria publicada en el BOE" if item["kind"] == "call" else
                           "Novedad en el BOE", "url": item["url"], "detail": item["label"]})
    sequence = previous.get("sequence", 0)
    numbered = [{**event, "id": sequence + index + 1, "at": checked_at}
                for index, event in enumerate(events)]
    return sequence + len(events), (numbered[::-1] + previous.get("changes", []))[:24]


def main():
    arguments = ArgumentParser(description=__doc__)
    arguments.add_argument("output", type=Path)
    arguments.add_argument("--baseline", type=Path)
    args = arguments.parse_args()
    source = args.output if args.output.exists() else args.baseline
    previous = json.loads(source.read_text()) if source else {}
    current = {**previous, "schema": 1}
    checked_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    today = datetime.now(ZoneInfo("Europe/Madrid")).date()
    errors = 0
    for check in (lambda: read_inap(previous, checked_at), lambda: read_boe(previous, today)):
        try:
            current.update(check())
        except (OSError, ValueError, KeyError, TypeError) as error:
            errors += 1
            print(f"Fuente oficial temporalmente no disponible: {error}")
    if errors == 2 or not current.get("calls"):
        raise SystemExit("Se conserva la última versión válida de los avisos")
    current.setdefault("boe", [])
    current["sequence"], current["changes"] = changes(previous, current, checked_at) if previous else (0, [])
    args.output.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n")
    print(f"INAP: {len(current['calls'])} fichas. BOE: {len(current['boe'])} publicaciones. Avisos: {current['sequence']}.")


if __name__ == "__main__":
    main()
