import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import fitz


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "payroll.json"
PDF_NAME_RE = re.compile(r"(FOPAG Florybal .+\.pdf)$")
EMPLOYEE_RE = re.compile(r"^(\d{1,6})\s{2,}([A-ZÁÉÍÓÚÂÊÔÃÕÇÜ0-9 .'\-]+)$")
MONEY_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$")


def normalize_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def br_number(value):
    text = f"{float(value):,.2f}"
    return text.replace(",", "_").replace(".", ",").replace("_", ".")


def source_pdf_path(source_file):
    match = PDF_NAME_RE.search(source_file)
    name = match.group(1) if match else source_file
    path = ROOT / name
    if not path.exists():
        raise FileNotFoundError(f"PDF original nao encontrado para {source_file}: {path}")
    return path


def clean_lines(text):
    return [line.strip() for line in text.splitlines() if line.strip()]


def page_lines(path):
    doc = fitz.open(path)
    return {page_index: clean_lines(page.get_text()) for page_index, page in enumerate(doc, 1)}


def employee_chunks(path):
    chunks = []
    current = None
    pages = page_lines(path)

    def flush(page_number):
        nonlocal current
        if current:
            chunks.append({**current, "sourcePage": page_number})
        current = None

    for page_index, lines in pages.items():
        for line in lines:
            if line.startswith("Total do(a)"):
                flush(page_index)
                break
            match = EMPLOYEE_RE.match(line)
            if match:
                flush(page_index)
                current = {"contract": match.group(1), "name": match.group(2).strip(), "lines": [line]}
                continue
            if current:
                current["lines"].append(line)
    flush(max(pages))
    return chunks


def chunk_index(path):
    index = {}
    fallback = defaultdict(list)
    for chunk in employee_chunks(path):
        key = (chunk["sourcePage"], chunk["contract"], normalize_text(chunk["name"]))
        index[key] = chunk
        fallback[(chunk["contract"], normalize_text(chunk["name"]))].append(chunk)
    return index, fallback


def find_employee_chunk(indexes, employee):
    index, fallback = indexes
    key = (int(employee["sourcePage"]), employee["contract"], normalize_text(employee["name"]))
    if key in index:
        chunk = index[key]
        return chunk["sourcePage"], chunk["lines"]
    matches = fallback.get((employee["contract"], normalize_text(employee["name"])), [])
    if len(matches) == 1:
        chunk = matches[0]
        return chunk["sourcePage"], chunk["lines"]
    return None, None


def following_money_values(chunk, index, limit=4):
    values = []
    for line in chunk[index + 1 : index + 1 + limit]:
        if MONEY_RE.match(line):
            values.append(line)
        elif values:
            break
    return values


def event_line_matches(line, event):
    match = re.match(r"^(\d{5})\s+(.+?)\s*$", line)
    return bool(match and match.group(1) == event["code"] and normalize_text(match.group(2)) == normalize_text(event["description"]))


def audit_event_values(employee, chunk):
    issues = []
    used_indexes = set()
    for event in employee.get("events", []):
        wanted_value = br_number(event.get("value", 0))
        wanted_quantity = br_number(event["quantity"]) if event.get("quantity") is not None else None
        found = False
        for index, line in enumerate(chunk):
            if index in used_indexes or not event_line_matches(line, event):
                continue
            numeric_lines = following_money_values(chunk, index)
            value_ok = wanted_value in numeric_lines or (event.get("value", 0) == 0 and not numeric_lines)
            quantity_ok = True if wanted_quantity is None else wanted_quantity in numeric_lines
            if value_ok and quantity_ok:
                used_indexes.add(index)
                found = True
                break
        if not found:
            issues.append(
                {
                    "type": "event_value_mismatch",
                    "event": f"{event['code']} {event['description']}",
                    "expectedValue": wanted_value,
                    "expectedQuantity": wanted_quantity or "-",
                }
            )
    return issues


def audit_total_values(employee, chunk_text):
    issues = []
    for key, label in [("gross", "bruto"), ("discounts", "descontos"), ("net", "liquido"), ("salary", "salario")]:
        value = employee["totals"].get(key)
        if not value:
            continue
        formatted = br_number(value)
        if formatted not in chunk_text:
            issues.append({"type": "total_not_found_in_chunk", "field": label, "expectedValue": formatted})
    return issues


def audit_category_sums(employee):
    issues = []
    checks = [
        ("overtime", "value", sum(event.get("value", 0) for event in employee["overtime"]["events"])),
        ("overtime", "hours", sum(event.get("quantity") or 0 for event in employee["overtime"]["events"])),
        ("medicalCertificates", "value", sum(event.get("value", 0) for event in employee.get("medicalCertificates", {}).get("events", []))),
        ("medicalCertificates", "hours", sum(event.get("quantity") or 0 for event in employee.get("medicalCertificates", {}).get("events", []))),
        ("absence", "value", sum(event.get("value", 0) for event in employee["absence"]["events"])),
        ("absence", "hours", sum(event.get("quantity") or 0 for event in employee["absence"]["events"])),
        ("variables", "value", sum(event.get("value", 0) for event in employee["variables"]["events"])),
        ("loans", "value", sum(event.get("value", 0) for event in employee["loans"]["events"])),
        ("vacation", "cost", sum(event.get("value", 0) for event in employee["vacation"]["events"])),
        ("vacationTermination", "cost", sum(event.get("value", 0) for event in employee.get("vacationTermination", {}).get("events", []))),
    ]
    for group, field, calculated in checks:
        expected = employee.get(group, {}).get(field) or 0
        if round(calculated - expected, 2) != 0:
            issues.append(
                {
                    "type": "category_sum_mismatch",
                    "group": group,
                    "field": field,
                    "expected": round(expected, 2),
                    "calculated": round(calculated, 2),
                }
            )
    return issues


def audit_records(dataset):
    chunks_by_pdf = {}
    issues = []
    counters = defaultdict(int)

    for employee in dataset["employees"]:
        pdf_path = source_pdf_path(employee["sourceFile"])
        if pdf_path.name not in chunks_by_pdf:
            chunks_by_pdf[pdf_path.name] = chunk_index(pdf_path)
        found_page, chunk = find_employee_chunk(chunks_by_pdf[pdf_path.name], employee)
        counters["records"] += 1
        counters[f"source::{pdf_path.name}"] += 1

        if not chunk:
            issues.append(
                {
                    "type": "employee_chunk_not_found",
                    "sourceFile": employee["sourceFile"],
                    "sourcePage": employee["sourcePage"],
                    "contract": employee["contract"],
                    "employee": employee["name"],
                }
            )
            continue

        chunk_text = "\n".join(chunk)
        record_issues = []
        record_issues.extend(audit_total_values(employee, chunk_text))
        record_issues.extend(audit_event_values(employee, chunk))
        record_issues.extend(audit_category_sums(employee))

        if record_issues:
            issues.append(
                {
                    "type": "record_value_issues",
                    "sourceFile": employee["sourceFile"],
                    "sourcePage": employee["sourcePage"],
                    "matchedPage": found_page,
                    "contract": employee["contract"],
                    "employee": employee["name"],
                    "issues": record_issues[:12],
                }
            )

    return counters, issues


def audit_reconciliation(dataset):
    reconciliation = dataset["quality"].get("reconciliation", [])
    return [row for row in reconciliation if not row.get("matched")]


def main():
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    counters, record_issues = audit_records(dataset)
    reconciliation_issues = audit_reconciliation(dataset)
    payload = {
        "recordsAudited": counters["records"],
        "sourcesAudited": len([key for key in counters if key.startswith("source::")]),
        "recordIssueCount": len(record_issues),
        "reconciliationIssueCount": len(reconciliation_issues),
        "unclassifiedEventCount": dataset["quality"].get("unclassifiedEventCount", 0),
        "diagnosticCount": dataset["quality"].get("diagnosticCount", 0),
        "issues": record_issues[:25],
        "reconciliationIssues": reconciliation_issues,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    if payload["recordIssueCount"] or payload["reconciliationIssueCount"] or payload["unclassifiedEventCount"] or payload["diagnosticCount"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
