import json
import re
import unicodedata
from datetime import datetime
from pathlib import Path

import fitz


DIRECTORY = json.loads(Path(__file__).with_name("company_directory.json").read_text(encoding="utf-8"))
DATE_RE = re.compile(r"\d{2}/\d{2}/\d{4}")
MONEY_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{1,2}$|^-?\d+,\d{1,2}$")


def normalized(value):
    value = unicodedata.normalize("NFKD", str(value or ""))
    return " ".join(value.encode("ascii", "ignore").decode().upper().split())


def br_number(value):
    try:
        return round(float(str(value).replace(".", "").replace(",", ".")), 2)
    except (TypeError, ValueError):
        return 0.0


def iso_date(value):
    try:
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    except (TypeError, ValueError):
        return None


def period_from_date(value):
    parsed = iso_date(value)
    if not parsed:
        return None
    return {
        "key": parsed[:7],
        "label": datetime.fromisoformat(parsed).strftime("%m/%Y"),
        "start": parsed[:7] + "-01",
        "end": parsed,
    }


def report_type(text):
    value = normalized(text)
    if "PROVISAO FERIAS" in value and "ENCARGOS" in value:
        return "vacation_provision"
    if "PROVISAO DE 13" in value and "ENCARGOS" in value:
        return "thirteenth_provision"
    if "CONTROLE E PROGRAMACAO DAS FERIAS" in value:
        return "vacation_schedule"
    if "FOLHA DE PAGAMENTO" in value and "FOLHAS:" in value:
        return "payroll"
    return "unknown"


def period_from_report(text, kind):
    if kind in {"vacation_provision", "thirteenth_provision", "payroll"}:
        match = re.search(r"Folhas(?: de|:)\s*(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})", text, re.I)
        if match:
            period = period_from_date(match.group(1))
            period["end"] = iso_date(match.group(2))
            return period
    match = re.search(r"Posi[^\n]{0,8}o em\s+(\d{2}/\d{2}/\d{4})", text, re.I)
    return period_from_date(match.group(1)) if match else None


def branch_info(code, printed_name=""):
    item = DIRECTORY["establishments"].get(str(code).zfill(3))
    if not item:
        return None
    name = item["name"] or printed_name
    return {
        "code": str(code).zfill(3),
        "name": name,
        "label": f"{str(code).zfill(3)} - {name}",
        "company": DIRECTORY["company"],
        "cnpj": item["cnpj"],
        "establishment": name,
        "workplace": name,
    }


def rows_by_y(page, tolerance=0.9):
    rows = []
    for word in sorted(page.get_text("words"), key=lambda item: (item[1], item[0])):
        if not rows or abs(rows[-1]["y"] - word[1]) > tolerance:
            rows.append({"y": word[1], "words": []})
        rows[-1]["words"].append({"x": word[0], "text": word[4]})
    for row in rows:
        row["words"].sort(key=lambda item: item["x"])
        row["text"] = " ".join(item["text"] for item in row["words"])
    return rows


def value_in_x(row, start, end):
    values = [item["text"] for item in row["words"] if start <= item["x"] < end and MONEY_RE.match(item["text"])]
    return br_number(values[-1]) if values else None


def text_in_x(row, start, end):
    return " ".join(item["text"] for item in row["words"] if start <= item["x"] < end).strip()


def page_branch(page):
    lines = [line.strip() for line in page.get_text("text").splitlines() if line.strip()]
    for index, line in enumerate(lines[:15]):
        if re.fullmatch(r"\d{3}", line) and index + 1 < len(lines):
            return branch_info(line, lines[index + 1])
        match = re.match(r"^(\d{3})\s+-\s+(.+)$", line)
        if match:
            return branch_info(match.group(1), match.group(2))
    return None


def parse_provision(path, kind):
    doc = fitz.open(path)
    first_text = doc[0].get_text("text")
    period = period_from_report(first_text, kind)
    diagnostics = []
    records = []
    summaries = []
    for page_number, page in enumerate(doc, 1):
        branch = page_branch(page)
        if not branch:
            diagnostics.append({"sourceFile": path.name, "sourcePage": page_number, "field": "estabelecimento", "level": "error", "message": "Estabelecimento não identificado."})
            continue
        page_rows = rows_by_y(page)
        for row in page_rows:
            contract = text_in_x(row, 25, 58)
            name = text_in_x(row, 58, 220)
            if not re.fullmatch(r"\d{1,6}", contract) or not re.search(r"[A-Za-zÀ-ÿ]", name):
                continue
            current = value_in_x(row, 400, 445)
            inss = value_in_x(row, 590, 630)
            fgts = value_in_x(row, 780, 825)
            basis = value_in_x(row, 220, 255)
            if current is None or inss is None or fgts is None:
                diagnostics.append({"sourceFile": path.name, "sourcePage": page_number, "field": "saldo atual", "level": "error", "message": f"Valores incompletos para o contrato {contract}."})
                continue
            records.append({
                "id": f"{kind}:{period['key']}:{branch['code']}:{contract}",
                "reportType": kind,
                "sourceFile": path.name,
                "sourcePage": page_number,
                "period": period,
                "company": branch["company"],
                "cnpj": branch["cnpj"],
                "branch": branch,
                "contract": contract,
                "name": name,
                "basis": basis or 0,
                "currentBalance": current,
                "inss": inss,
                "fgts": fgts,
                "total": round(current + inss + fgts, 2),
            })
        branch_rows = [
            row for row in page_rows
            if "FLORYBAL" in normalized(row["text"])
            and "CHOCOLATES" not in normalized(row["text"])
            and "CONTR" in normalized(row["text"])
        ]
        if branch_rows:
            row = branch_rows[-1]
            current = value_in_x(row, 400, 445)
            inss = value_in_x(row, 590, 630)
            fgts = value_in_x(row, 780, 825)
            if None not in (current, inss, fgts):
                summaries.append({"reportType": kind, "sourceFile": path.name, "sourcePage": page_number, "period": period, "branch": branch, "isGrandTotal": False, "currentBalance": current, "inss": inss, "fgts": fgts, "total": round(current + inss + fgts, 2)})
    last_rows = rows_by_y(doc[-1])
    company_rows = [row for row in last_rows if "FLORYBAL CHOCOLATES" in normalized(row["text"]) and "CONTR" in normalized(row["text"])]
    if company_rows:
        row = company_rows[-1]
        current = value_in_x(row, 400, 445)
        inss = value_in_x(row, 590, 630)
        fgts = value_in_x(row, 780, 825)
        if None not in (current, inss, fgts):
            summaries.append({"reportType": kind, "sourceFile": path.name, "sourcePage": len(doc), "period": period, "branch": None, "isGrandTotal": True, "currentBalance": current, "inss": inss, "fgts": fgts, "total": round(current + inss + fgts, 2)})
    return records, summaries, diagnostics, period


def schedule_row(row, employee, branch, period, source_file, page_number):
    start = text_in_x(row, 225, 285)
    end = text_in_x(row, 285, 345).replace("a ", "").strip()
    if not DATE_RE.fullmatch(start) or not DATE_RE.fullmatch(end):
        return None
    absences = br_number(text_in_x(row, 345, 390))
    lost = br_number(text_in_x(row, 390, 430))
    taken = br_number(text_in_x(row, 430, 480))
    bonus = br_number(text_in_x(row, 480, 520))
    balance = br_number(text_in_x(row, 520, 560))
    deadline = text_in_x(row, 560, 620)
    scheduled = text_in_x(row, 620, 680)
    scheduled_days = br_number(text_in_x(row, 680, 720))
    return {
        "id": f"vacation_schedule:{period['key']}:{branch['code']}:{employee['contract']}:{iso_date(start)}",
        "reportType": "vacation_schedule",
        "sourceFile": source_file,
        "sourcePage": page_number,
        "period": period,
        "company": branch["company"],
        "cnpj": branch["cnpj"],
        "branch": branch,
        "contract": employee["contract"],
        "name": employee["name"],
        "acquisitionStart": iso_date(start),
        "acquisitionEnd": iso_date(end),
        "deadline": iso_date(deadline),
        "absences": absences,
        "lostDays": lost,
        "daysTaken": taken,
        "bonusDays": bonus,
        "balanceDays": balance,
        "totalDays": round(taken + bonus + balance, 2),
        "scheduledDate": iso_date(scheduled),
        "scheduledDays": scheduled_days,
    }


def parse_vacation_schedule(path):
    doc = fitz.open(path)
    first_text = doc[0].get_text("text")
    period = period_from_report(first_text, "vacation_schedule")
    diagnostics = []
    records = []
    for page_number, page in enumerate(doc, 1):
        branch = page_branch(page)
        if not branch:
            diagnostics.append({"sourceFile": path.name, "sourcePage": page_number, "field": "estabelecimento", "level": "error", "message": "Estabelecimento não identificado."})
            continue
        employee = None
        for row in rows_by_y(page):
            contract = text_in_x(row, 20, 62)
            name = text_in_x(row, 62, 225)
            if re.fullmatch(r"\d{1,6}", contract) and re.search(r"[A-Za-zÀ-ÿ]", name):
                employee = {"contract": contract, "name": name}
            if not employee:
                continue
            parsed = schedule_row(row, employee, branch, period, path.name, page_number)
            if parsed:
                records.append(parsed)
    if not records:
        diagnostics.append({"sourceFile": path.name, "sourcePage": None, "field": "períodos aquisitivos", "level": "error", "message": "Nenhum período aquisitivo foi lido."})
    return records, diagnostics, period


def parse_special_report(path):
    path = Path(path)
    doc = fitz.open(path)
    text = "\n".join(page.get_text("text") for page in doc[: min(2, len(doc))])
    kind = report_type(text)
    if kind in {"vacation_provision", "thirteenth_provision"}:
        records, summaries, diagnostics, period = parse_provision(path, kind)
        return kind, period, records, summaries, [], diagnostics
    if kind == "vacation_schedule":
        records, diagnostics, period = parse_vacation_schedule(path)
        return kind, period, [], [], records, diagnostics
    return kind, None, [], [], [], [{
        "sourceFile": path.name,
        "sourcePage": 1,
        "field": "tipo do relatório",
        "level": "error",
        "message": "O arquivo não corresponde a folha, provisão de férias, provisão de 13º ou programação de férias.",
    }]
