import argparse
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import fitz


RULES_PATH = Path(__file__).with_name("event_rules.json")
MONEY_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$")
EMPLOYEE_RE = re.compile(r"^(\d{1,6})\s{2,}([A-ZÁÉÍÓÚÂÊÔÃÕÇÜ0-9 .'\-]+)$")
EVENT_RE = re.compile(r"^(\d{5})\s+(.+?)\s*$")
PERIOD_RE = re.compile(r"Folhas:\s*(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})")
BRANCH_RE = re.compile(r"^(\d{3})\s+-\s+(.+)$")
EVENT_RULES = json.loads(RULES_PATH.read_text(encoding="utf-8"))


def br_money(value):
    if value is None:
        return 0.0
    value = value.strip().replace(".", "").replace(",", ".")
    try:
        return round(float(value), 2)
    except ValueError:
        return 0.0


def parse_date(value):
    if not value:
        return None
    try:
        return datetime.strptime(value, "%d/%m/%Y").date().isoformat()
    except ValueError:
        return None


def month_key(date_value):
    parsed = parse_date(date_value)
    return parsed[:7] if parsed else None


def clean_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def normalize_branch_name(value):
    name = re.sub(r"\s+", " ", value.strip())
    return re.sub(r"\bFILIAL(\d{2})\b", r"FILIAL \1", name)


def page_context(lines):
    period = None
    branch = None
    for line in lines[:25]:
        period_match = PERIOD_RE.search(line)
        if period_match:
            start, end = period_match.groups()
            period = {
                "start": parse_date(start),
                "end": parse_date(end),
                "key": month_key(start),
                "label": datetime.strptime(start, "%d/%m/%Y").strftime("%m/%Y"),
            }
        branch_match = BRANCH_RE.match(line)
        if branch_match:
            branch_name = normalize_branch_name(branch_match.group(2))
            branch = {
                "code": branch_match.group(1),
                "name": branch_name,
                "label": f"{branch_match.group(1)} - {branch_name}",
            }
    return period, branch


def split_employee_chunks(lines):
    chunks = []
    current = None
    for line in lines:
        match = EMPLOYEE_RE.match(line)
        if match:
            if current:
                chunks.append(current)
            current = {"contract": match.group(1), "name": match.group(2).strip(), "lines": [line]}
            continue
        if current:
            current["lines"].append(line)
    if current:
        chunks.append(current)
    return chunks


def following_numbers(lines, index, limit=3):
    nums = []
    for line in lines[index + 1 : index + 1 + limit]:
        if MONEY_RE.match(line):
            nums.append(br_money(line))
        else:
            break
    return nums


def parse_events(lines):
    events = []
    for index, line in enumerate(lines):
        match = EVENT_RE.match(line)
        if not match:
            continue
        nums = following_numbers(lines, index)
        value = nums[-1] if nums else 0.0
        quantity = nums[0] if len(nums) > 1 else None
        events.append(
            {
                "code": match.group(1),
                "description": re.sub(r"\s+", " ", match.group(2)).strip(),
                "quantity": quantity,
                "value": value,
            }
        )
    return events


def event_matches_rule(event, rule):
    description = event["description"].lower()
    if event["code"] in set(rule.get("codes", [])):
        return True
    includes = [item.lower() for item in rule.get("descriptionIncludes", [])]
    if includes and not all(item in description for item in includes):
        return False
    includes_any = [item.lower() for item in rule.get("descriptionIncludesAny", [])]
    if includes_any and not any(item in description for item in includes_any):
        return False
    return bool(includes or includes_any)


def event_kind(event, group):
    for rule in EVENT_RULES.get(group, []):
        if event_matches_rule(event, rule):
            return rule.get("kind", group)
    return None


def overtime_kind(event):
    return event_kind(event, "overtime")


def absence_kind(event):
    return event_kind(event, "absence")


def variable_kind(event):
    return event_kind(event, "variables")


def loan_kind(event):
    return event_kind(event, "loans")


def vacation_kind(event):
    return event_kind(event, "vacations")


def is_classified_event(event):
    return any(event_kind(event, group) for group in EVENT_RULES)


def amount_after_label(text, label, default=0.0):
    pattern = re.compile(re.escape(label) + r"(?:\n|.){0,80}?(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})", re.I)
    match = pattern.search(text)
    return br_money(match.group(1)) if match else default


def amount_after_exact_line(lines, labels, default=0.0):
    normalized_labels = {re.sub(r"\s+", " ", label).strip().lower() for label in labels}
    for index, line in enumerate(lines):
        normalized_line = re.sub(r"^\*+\s*", "", line).strip()
        normalized_line = re.sub(r"\s+", " ", normalized_line).lower()
        if normalized_line in normalized_labels:
            for next_line in lines[index + 1 : index + 5]:
                if MONEY_RE.match(next_line):
                    return br_money(next_line)
    return default


def exact_line_value_near(lines, start_index, label, window=35):
    normalized_label = re.sub(r"\s+", " ", label).strip().lower()
    for index in range(start_index, min(len(lines), start_index + window)):
        normalized_line = re.sub(r"^\*+\s*", "", lines[index]).strip()
        normalized_line = re.sub(r"\s+", " ", normalized_line).lower()
        if normalized_line == normalized_label:
            for next_line in lines[index + 1 : index + 5]:
                if MONEY_RE.match(next_line):
                    return br_money(next_line)
    return None


def sum_amounts_after_labels(text, labels):
    total = 0.0
    for label in labels:
        pattern = re.compile(
            re.escape(label) + r"(?:\n|.){0,80}?(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})",
            re.I,
        )
        total += sum(br_money(match.group(1)) for match in pattern.finditer(text))
    return total


def extract_employee(chunk, period, branch, source_file, page_number):
    lines = chunk["lines"]
    text = "\n".join(lines)
    events = parse_events(lines)
    admission = re.search(r"Admissão\s+(\d{2}/\d{2}/\d{4})", text)
    resignation = re.search(r"Rescisão\s+(\d{2}/\d{2}/\d{4})", text)
    job = re.search(r"Cargo\.+\s*([^\n]+)", text)
    vacation = re.search(r"(?:Últimas|Ultimas) Férias de\s+(\d{2}/\d{2}/\d{4})\s+até\s+(\d{2}/\d{2}/\d{4})", text)

    overtime_events = [event for event in events if overtime_kind(event)]
    absence_events = [{**event, "kind": absence_kind(event)} for event in events if absence_kind(event)]
    variable_events = [{**event, "kind": variable_kind(event)} for event in events if variable_kind(event)]
    loan_events = [event for event in events if loan_kind(event)]
    vacation_events = [event for event in events if vacation_kind(event)]
    unclassified_events = [event for event in events if not is_classified_event(event)]

    totals = {
        "gross": amount_after_exact_line(lines, ["Total dos Vencimentos"]),
        "discounts": amount_after_exact_line(lines, ["Total dos Descontos"]),
        "net": amount_after_exact_line(lines, ["Líquido"]),
        "salary": amount_after_exact_line(lines, ["Salário Mensal"]),
    }

    charges = {
        "inss_employee": sum(event["value"] for event in events if "INSS sobre" in event["description"]),
        "inss_company": sum_amounts_after_labels(text, ["INSS Empr.", "INSS Parte Empresa", "INSS Parte Empreg."]),
        "fgts": sum_amounts_after_labels(
            text,
            [
                "FGTS sobre Salários",
                "FGTS sobre as Férias",
                "FGTS sobre o 13º Salário",
                "FGTS s/Rescisão",
                "FGTS s/Val. Pagos",
            ],
        ),
        "rat_fap": sum_amounts_after_labels(text, ["RATxFAP"]),
        "third_parties": sum_amounts_after_labels(text, ["Terceiros Emp.", "Terc. Parte Empresa"]),
        "gps_total": sum_amounts_after_labels(text, ["TOTAL GPS"]),
        "irrf": sum(event["value"] for event in events if "I.R.F" in event["description"] or "IRF" in event["description"]),
    }

    overtime_hours = round(sum(event["quantity"] or 0 for event in overtime_events), 2)
    overtime_value = round(sum(event["value"] for event in overtime_events), 2)
    absence_hours = round(sum(event["quantity"] or 0 for event in absence_events), 2)
    absence_value = round(sum(event["value"] for event in absence_events), 2)
    loan_value = round(sum(event["value"] for event in loan_events), 2)

    vacation_start = parse_date(vacation.group(1)) if vacation else None
    vacation_end = parse_date(vacation.group(2)) if vacation else None
    vacation_days = None
    if vacation_start and vacation_end:
        start = datetime.fromisoformat(vacation_start).date()
        end = datetime.fromisoformat(vacation_end).date()
        vacation_days = (end - start).days + 1

    validation = []
    if not admission:
        validation.append("Funcionário sem data de admissão extraída")
    if totals["gross"] and totals["discounts"] and totals["net"]:
        if abs((totals["gross"] - totals["discounts"]) - totals["net"]) > 2.0:
            validation.append("Totais não reconciliam exatamente com vencimentos - descontos")
    if overtime_hours > 40:
        validation.append("Horas extras acima de 40h no mês")
    if absence_hours >= 24:
        validation.append("Alerta vermelho: faltas/atrasos acima de 24h no mês")
    elif absence_hours >= 8:
        validation.append("Alerta amarelo: faltas/atrasos acima de 8h no mês")
    if totals["net"] < 0:
        validation.append("Líquido negativo")

    return {
        "id": f"{source_file}:{page_number}:{chunk['contract']}",
        "sourceFile": source_file,
        "sourcePage": page_number,
        "period": period,
        "branch": branch,
        "contract": chunk["contract"],
        "name": chunk["name"],
        "admissionDate": parse_date(admission.group(1)) if admission else None,
        "resignationDate": parse_date(resignation.group(1)) if resignation else None,
        "jobTitle": job.group(1).strip() if job else "",
        "totals": totals,
        "charges": {key: round(value, 2) for key, value in charges.items()},
        "overtime": {"hours": overtime_hours, "value": overtime_value, "events": overtime_events},
        "absence": {"hours": absence_hours, "value": absence_value, "events": absence_events},
        "variables": {"value": round(sum(event["value"] for event in variable_events), 2), "events": variable_events},
        "unclassifiedEvents": unclassified_events,
        "loans": {"value": loan_value, "events": loan_events},
        "vacation": {
            "start": vacation_start,
            "end": vacation_end,
            "days": vacation_days,
            "cost": round(sum(event["value"] for event in vacation_events), 2),
            "events": vacation_events,
        },
        "events": events,
        "validation": validation,
    }


def parse_pdf(path, diagnostics=None):
    employees = []
    doc = fitz.open(path)
    current_period = None
    current_branch = None
    current_chunk = None
    diagnostics = diagnostics if diagnostics is not None else []

    def flush_current(page_number):
        nonlocal current_chunk
        if current_chunk and current_period and current_branch:
            employees.append(extract_employee(current_chunk, current_period, current_branch, path.name, page_number))
        current_chunk = None

    for page_index, page in enumerate(doc, 1):
        lines = clean_lines(page.get_text())
        period, branch = page_context(lines)
        if (period and current_period and period["key"] != current_period["key"]) or (
            branch and current_branch and branch["code"] != current_branch["code"]
        ):
            flush_current(page_index)
        current_period = period or current_period
        current_branch = branch or current_branch
        if not current_period or not current_branch:
            diagnostics.append(
                {
                    "sourceFile": path.name,
                    "sourcePage": page_index,
                    "level": "warning",
                    "message": "Página sem competência ou filial detectada antes dos registros.",
                }
            )
            continue
        for line in lines:
            if line.startswith("Total do(a)"):
                flush_current(page_index)
                break
            match = EMPLOYEE_RE.match(line)
            if match:
                flush_current(page_index)
                current_chunk = {"contract": match.group(1), "name": match.group(2).strip(), "lines": [line]}
                continue
            if current_chunk:
                current_chunk["lines"].append(line)
    flush_current(doc.page_count)
    return employees


def extract_pdf_grand_total(path):
    grand_total = None
    doc = fitz.open(path)
    for page_index, page in enumerate(doc, 1):
        lines = clean_lines(page.get_text())
        for index, line in enumerate(lines):
            if "Total dos Vencimentos" not in line:
                continue
            gross = exact_line_value_near(lines, index, "Total dos Vencimentos")
            if gross is None:
                continue
            grand_total = {
                "sourceFile": path.name,
                "sourcePage": page_index,
                "gross": gross,
                "discounts": exact_line_value_near(lines, index, "Total dos Descontos") or 0.0,
                "net": exact_line_value_near(lines, index, "Líquido") or 0.0,
            }
    return grand_total


def build_dataset(paths):
    employees = []
    source_totals = []
    diagnostics = []
    for path in paths:
        pdf_path = Path(path)
        employees.extend(parse_pdf(pdf_path, diagnostics))
        total = extract_pdf_grand_total(pdf_path)
        if total:
            source_totals.append(total)
        else:
            diagnostics.append(
                {
                    "sourceFile": pdf_path.name,
                    "sourcePage": None,
                    "level": "error",
                    "message": "Total geral do PDF não encontrado para reconciliação.",
                }
            )

    periods = sorted({item["period"]["key"] for item in employees if item["period"]})
    branches = sorted(
        {json.dumps(item["branch"], ensure_ascii=False, sort_keys=True) for item in employees if item["branch"]}
    )
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sources": [Path(path).name for path in paths],
        "periods": periods,
        "branches": [json.loads(item) for item in branches],
        "employees": employees,
        "quality": summarize_quality(employees, source_totals, diagnostics),
    }


def summarize_quality(employees, source_totals, diagnostics=None):
    warnings = []
    unclassified = defaultdict(lambda: {"count": 0, "quantity": 0.0, "value": 0.0, "examples": []})
    by_source = defaultdict(lambda: {"employeeRecords": 0, "gross": 0.0, "discounts": 0.0, "net": 0.0})
    for employee in employees:
        source = by_source[employee["sourceFile"]]
        source["employeeRecords"] += 1
        source["gross"] += employee["totals"]["gross"]
        source["discounts"] += employee["totals"]["discounts"]
        source["net"] += employee["totals"]["net"]
        for warning in employee["validation"]:
            warnings.append({"employee": employee["name"], "contract": employee["contract"], "warning": warning})
        for event in employee.get("unclassifiedEvents", []):
            key = f"{event['code']}|{event['description']}"
            row = unclassified[key]
            row["code"], row["description"] = event["code"], event["description"]
            row["count"] += 1
            row["quantity"] += event["quantity"] or 0
            row["value"] += event["value"] or 0
            if len(row["examples"]) < 3:
                row["examples"].append(
                    {
                        "sourceFile": employee["sourceFile"],
                        "sourcePage": employee["sourcePage"],
                        "period": employee["period"]["label"],
                        "branch": employee["branch"]["label"],
                        "contract": employee["contract"],
                        "employee": employee["name"],
                    }
                )
    reconciliation = []
    for total in source_totals:
        summed = by_source[total["sourceFile"]]
        diffs = {
            key: round(summed[key] - total[key], 2)
            for key in ["gross", "discounts", "net"]
        }
        reconciliation.append(
            {
                "sourceFile": total["sourceFile"],
                "sourcePage": total["sourcePage"],
                "pdf": {key: round(total[key], 2) for key in ["gross", "discounts", "net"]},
                "app": {key: round(summed[key], 2) for key in ["gross", "discounts", "net"]},
                "difference": diffs,
                "matched": all(abs(value) <= 0.01 for value in diffs.values()),
            }
        )
    return {
        "employeeRecords": len(employees),
        "recordsBySource": {
            key: {
                "employeeRecords": value["employeeRecords"],
                "gross": round(value["gross"], 2),
                "discounts": round(value["discounts"], 2),
                "net": round(value["net"], 2),
            }
            for key, value in sorted(by_source.items())
        },
        "reconciliation": reconciliation,
        "reconciliationMatched": all(item["matched"] for item in reconciliation) if reconciliation else False,
        "diagnostics": diagnostics or [],
        "diagnosticCount": len(diagnostics or []),
        "unclassifiedEvents": [
            {
                **value,
                "quantity": round(value["quantity"], 2),
                "value": round(value["value"], 2),
            }
            for value in sorted(unclassified.values(), key=lambda item: (-abs(item["value"]), item["code"]))
        ],
        "unclassifiedEventCount": sum(item["count"] for item in unclassified.values()),
        "warnings": warnings[:250],
        "warningCount": len(warnings),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pdfs", nargs="+")
    parser.add_argument("--out")
    args = parser.parse_args()
    dataset = build_dataset(args.pdfs)
    payload = json.dumps(dataset, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
    else:
        print(payload)


if __name__ == "__main__":
    main()
