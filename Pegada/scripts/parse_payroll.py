import argparse
import json
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import fitz

from report_parsers import DIRECTORY, branch_info, br_number, normalized, parse_special_report, report_type, rows_by_y, text_in_x, value_in_x


RULES_PATH = Path(__file__).with_name("event_rules.json")
MONEY_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{2}$|^-?\d+,\d{2}$")
EMPLOYEE_RE = re.compile(r"^(\d{1,10})\s+-\s+(.+)$")
EVENT_RE = re.compile(r"^(\d{5})\s+(.+?)\s*$")
PERIOD_RE = re.compile(r"Folhas:\s*(\d{2}/\d{2}/\d{4})\s+a\s+(\d{2}/\d{2}/\d{4})")
BRANCH_RE = re.compile(r"^(\d{4})\s+-\s+(.+)$")
EVENT_RULES = json.loads(RULES_PATH.read_text(encoding="utf-8"))
FGTS_CODES = {"00474", "00475", "00476"}
INSS_COMPANY_CODES = set()
OFFICIAL_FGTS_CODES = {"00474", "00475", "00476"}
OFFICIAL_INSS_COMPANY_CODES = set()
RESIGNATION_CHARGE_CODES = {"00478", "00479"}


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


def format_cnpj(value):
    digits = re.sub(r"\D", "", value or "")
    if len(digits) != 14:
        return value or ""
    return f"{digits[:2]}.{digits[2:5]}.{digits[5:8]}/{digits[8:12]}-{digits[12:]}"


def page_context(lines):
    period = None
    branch = None
    company = next((line for line in lines[:12] if "PEGADA NORDESTE" in line.upper()), DIRECTORY["company"])
    cnpj_match = re.search(r"CNPJ:\s*(\d{8}/\d{4}-\d{2})", " ".join(lines[:25]), re.I)
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
            directory_branch = branch_info(branch_match.group(1), branch_name)
            if not directory_branch:
                continue
            branch = directory_branch
            if cnpj_match:
                branch["cnpj"] = format_cnpj(cnpj_match.group(1))
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


EVENT_COLUMNS = (
    {"side": "earnings", "code": (30, 57), "description": (57, 215), "quantity": (215, 250), "value": (250, 295)},
    {"side": "discounts", "code": (295, 315), "description": (315, 475), "quantity": (475, 510), "value": (510, 553)},
    {"side": "bases", "code": (553, 573), "description": (573, 725), "quantity": (725, 760), "value": (760, 825)},
)


def coordinate_events(row):
    events = []
    for column in EVENT_COLUMNS:
        code = text_in_x(row, *column["code"])
        if not re.fullmatch(r"\d{5}", code):
            continue
        description = text_in_x(row, *column["description"])
        quantity = value_in_x(row, *column["quantity"])
        value = value_in_x(row, *column["value"])
        events.append({
            "code": code,
            "description": re.sub(r"\s+", " ", description).strip(),
            "quantity": quantity,
            "value": value or 0.0,
            "side": column["side"],
        })
    return events


def employee_header(row):
    if "Contrato:" not in row["text"]:
        return None
    identity = text_in_x(row, 75, 300)
    identity_match = re.match(r"^(\d{1,10})\s+-\s+(.+)$", identity)
    if not identity_match:
        return None
    contract, name = identity_match.groups()
    admission_match = re.search(r"Admissão:\s*(\d{2}/\d{2}/\d{4})", row["text"], re.I)
    job = text_in_x(row, 385, 610).replace("Cargo:", "").strip()
    salary_text = text_in_x(row, 610, 730)
    salary_values = re.findall(r"-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2}", salary_text)
    return {
        "contract": contract,
        "name": name,
        "admissionDate": parse_date(admission_match.group(1)) if admission_match else None,
        "jobTitle": job,
        "salary": br_money(salary_values[-1]) if salary_values else 0.0,
    }


def event_matches_rule(event, rule):
    description = event["description"].lower()
    if event["code"] in set(rule.get("excludeCodes", [])):
        return False
    excludes = [item.lower() for item in rule.get("excludeDescriptionIncludesAny", [])]
    if excludes and any(item in description for item in excludes):
        return False
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


def overtime_reflex_kind(event):
    return event_kind(event, "overtime_reflexes")


def medical_certificate_kind(event):
    return event_kind(event, "medical_certificates")


def absence_kind(event):
    return event_kind(event, "absence")


def variable_kind(event):
    if overtime_kind(event):
        return None
    return event_kind(event, "variables")


def loan_kind(event):
    return event_kind(event, "loans")


def vacation_kind(event):
    return event_kind(event, "vacations")


def vacation_termination_kind(event):
    return event_kind(event, "vacation_termination")


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


def sum_amounts_after_codes(lines, codes):
    total = 0.0
    code_set = set(codes)
    for index, line in enumerate(lines):
        if line.strip() not in code_set:
            continue
        for next_line in lines[index + 1 : index + 5]:
            if MONEY_RE.match(next_line):
                total += br_money(next_line)
                break
    return total


def charge_values_after_codes(lines):
    return {
        "fgts": sum_amounts_after_codes(lines, OFFICIAL_FGTS_CODES),
        "inss_company": sum_amounts_after_codes(lines, OFFICIAL_INSS_COMPANY_CODES),
        "resignation_charges": sum_amounts_after_codes(lines, RESIGNATION_CHARGE_CODES),
    }


def sum_summary_word_values(page, codes):
    total = 0.0
    words = page.get_text("words")
    for code in codes:
        for word in words:
            if word[4] != code or word[0] > 100:
                continue
            values = [candidate[4] for candidate in words if abs(candidate[1] - word[1]) <= 0.8 and 250 <= candidate[0] < 300 and MONEY_RE.match(candidate[4])]
            if values:
                total += br_money(values[-1])
    return round(total, 2)


def extract_charge_summaries(path):
    summaries = []
    doc = fitz.open(path)
    current_period = None
    current_summary = None

    def finish_summary():
        nonlocal current_summary
        if not current_summary:
            return
        events = current_summary.pop("events")
        by_code = {event["code"]: event for event in events}
        event_value = lambda code: by_code.get(code, {}).get("value", 0.0)
        remuneration_earnings = round(sum(event["value"] for event in events if event.get("side") == "earnings" and event_kind(event, "remuneration_earnings")), 2)
        remuneration_discounts = round(sum(event["value"] for event in events if event.get("side") == "discounts" and event_kind(event, "remuneration_discounts")), 2)
        current_summary["events"] = events
        current_summary["charges"] = {
            "fgts": round(sum(event_value(code) for code in FGTS_CODES), 2),
            "resignation_charges": round(sum(event_value(code) for code in RESIGNATION_CHARGE_CODES), 2),
            "inss_company": 0.0,
            "rat_fap": 0.0,
            "third_parties": 0.0,
        }
        current_summary["payroll"].update({
            "vacationsTakenGross": round(event_value("71198") + event_value("71199"), 2),
            "vacationsNet": event_value("00498"),
            "resignationsNet": event_value("00499"),
            "payrollNet": event_value("00500"),
            "remunerationEarnings": remuneration_earnings,
            "remunerationDiscounts": remuneration_discounts,
            "remunerationNet": round(remuneration_earnings - remuneration_discounts, 2),
            "maternity": round(sum(event["value"] for event in events if event_kind(event, "maternity")), 2),
            "proLabore": round(sum(event["value"] for event in events if event_kind(event, "pro_labore")), 2),
        })
        summaries.append(current_summary)
        current_summary = None

    for page_index, page in enumerate(doc, 1):
        lines = clean_lines(page.get_text())
        period, branch = page_context(lines)
        current_period = period or current_period
        total_line = next((line for line in lines if line.startswith("Total do(a)")), None)
        if total_line:
            finish_summary()
            is_grand_total = "CALCADOS PEGADA NORDESTE LTDA" in normalized(total_line)
            if current_period and (branch or is_grand_total):
                current_summary = {
                "sourceFile": path.name,
                "sourcePage": page_index,
                "period": current_period,
                "branch": None if is_grand_total else branch,
                "isGrandTotal": is_grand_total,
                "company": DIRECTORY["company"],
                "cnpj": "" if is_grand_total else branch.get("cnpj", ""),
                "counts": {},
                "events": [],
                "payroll": {},
                }
        if not current_summary:
            continue

        for row in rows_by_y(page):
            current_summary["events"].extend(coordinate_events(row))
            base_label = normalized(text_in_x(row, 553, 760)).replace("*", "").strip()
            base_value = text_in_x(row, 760, 825).replace(".", "").replace(",", ".")
            number = float(base_value) if re.fullmatch(r"\d+(?:\.\d+)?", base_value) else None
            count_mapping = {
                "TOTAL DE DIRETORES": "directors",
                "TOTAL DE AUTONOMOS": "autonomous",
                "TOTAL DE CONTRATOS DE FUNCIONARIOS": "contracts",
                "ATIVOS": "active",
                "AFASTADOS": "onLeave",
                "RESCINDIDOS": "terminated",
                "TOTAL ADMITIDOS NO PERIODO": "admissions",
                "TOTAL RESCINDIDOS NO PERIODO": "resignations",
            }
            if base_label in count_mapping and number is not None:
                current_summary["counts"][count_mapping[base_label]] = int(number)
            if base_label == "TOTAL DOS SALARIOS" and number is not None:
                current_summary["payroll"]["totalSalaries"] = number

            normalized_row = normalized(row["text"])
            if "TOTAL DE VENCIMENTOS:" in normalized_row and "TOTAL DE DESCONTOS:" in normalized_row:
                current_summary["payroll"].update({
                    "gross": value_in_x(row, 250, 295) or 0.0,
                    "discounts": value_in_x(row, 510, 553) or 0.0,
                    "net": value_in_x(row, 760, 825) or 0.0,
                })
                finish_summary()
    finish_summary()
    return summaries


def extract_employee(chunk, period, branch, source_file, page_number):
    lines = chunk["lines"]
    text = "\n".join(lines)
    events = chunk.get("events") or parse_events(lines)
    admission = re.search(r"Admissão:?\s+(\d{2}/\d{2}/\d{4})", text)
    resignation = re.search(r"Rescisão:?\s+(\d{2}/\d{2}/\d{4})", text)
    job = re.search(r"Cargo:?\s*([^\n]+)", text)
    vacation = re.search(r"(?:Últimas|Ultimas) Férias de\s+(\d{2}/\d{2}/\d{4})\s+até\s+(\d{2}/\d{2}/\d{4})", text)

    overtime_events = [event for event in events if overtime_kind(event)]
    overtime_reflex_events = [{**event, "kind": overtime_reflex_kind(event)} for event in events if overtime_reflex_kind(event)]
    medical_certificate_events = [{**event, "kind": medical_certificate_kind(event)} for event in events if medical_certificate_kind(event)]
    absence_events = [{**event, "kind": absence_kind(event)} for event in events if absence_kind(event)]
    variable_events = [{**event, "kind": variable_kind(event)} for event in events if variable_kind(event)]
    loan_events = [event for event in events if loan_kind(event)]
    vacation_events = [event for event in events if vacation_kind(event)]
    vacation_termination_events = [event for event in events if vacation_termination_kind(event)]
    unclassified_events = [event for event in events if not is_classified_event(event)]

    totals = chunk.get("totals") or {
        "gross": amount_after_exact_line(lines, ["Total dos Vencimentos"]),
        "discounts": amount_after_exact_line(lines, ["Total dos Descontos"]),
        "net": amount_after_exact_line(lines, ["Líquido"]),
        "salary": chunk.get("salary") or amount_after_exact_line(lines, ["Salário Mensal", "Salário Hora"]),
    }
    totals.setdefault("salary", chunk.get("salary") or 0.0)

    charges = {
        "inss_employee": sum(
            event["value"]
            for event in events
            if event.get("side") == "discounts" and event["code"] in {"00381", "00382", "00383", "00384"}
        ),
        "inss_company": sum_amounts_after_codes(lines, INSS_COMPANY_CODES),
        "fgts": sum_amounts_after_codes(lines, FGTS_CODES),
        "rat_fap": sum_amounts_after_labels(text, ["RATxFAP"]),
        "third_parties": sum_amounts_after_labels(text, ["Terceiros Emp.", "Terc. Parte Empresa"]),
        "gps_total": sum_amounts_after_labels(text, ["TOTAL GPS"]),
        "irrf": sum(
            event["value"]
            for event in events
            if event.get("side") == "discounts" and event["code"] in {"00391", "00392"}
        ),
    }

    overtime_hours = round(sum(event["quantity"] or 0 for event in overtime_events), 2)
    overtime_value = round(sum(event["value"] for event in overtime_events), 2)
    overtime_reflex_value = round(sum(event["value"] for event in overtime_reflex_events), 2)
    medical_certificate_hours = round(sum(event["quantity"] or 0 for event in medical_certificate_events), 2)
    medical_certificate_value = round(sum(event["value"] for event in medical_certificate_events), 2)
    absence_hours = round(sum(event["quantity"] or 0 for event in absence_events if event["code"] in {"00201", "00202"}), 2)
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
    if not (chunk.get("admissionDate") or admission):
        validation.append("Colaborador sem data de admissão extraída")
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

    remuneration_earnings = round(sum(event["value"] for event in events if event.get("side") == "earnings" and event_kind(event, "remuneration_earnings")), 2)
    remuneration_discounts = round(sum(event["value"] for event in events if event.get("side") == "discounts" and event_kind(event, "remuneration_discounts")), 2)
    maternity_value = round(sum(event["value"] for event in events if event_kind(event, "maternity")), 2)
    pro_labore_value = round(sum(event["value"] for event in events if event_kind(event, "pro_labore")), 2)
    normalized_job = (chunk.get("jobTitle") or (job.group(1).strip() if job else "")).lower()
    if pro_labore_value or "diretor" in normalized_job or "sócio" in normalized_job or "socio" in normalized_job:
        workforce_type = "pro_labore"
    elif "aprendiz" in normalized_job:
        workforce_type = "apprentice"
    elif "tempor" in normalized_job:
        workforce_type = "temporary"
    elif any(event["code"] in {"00006", "00007", "00662", "00772"} for event in events):
        workforce_type = "leave"
    elif any(event["code"] == "00111" for event in events):
        workforce_type = "autonomous"
    else:
        workforce_type = "employee"

    return {
        "id": f"{source_file}:{page_number}:{chunk['contract']}",
        "sourceFile": source_file,
        "sourcePage": chunk.get("sourcePage", page_number),
        "period": period,
        "branch": branch,
        "contract": chunk["contract"],
        "name": chunk["name"],
        "company": branch.get("company"),
        "cnpj": branch.get("cnpj"),
        "admissionDate": chunk.get("admissionDate") or (parse_date(admission.group(1)) if admission else None),
        "resignationDate": chunk.get("resignationDate") or (parse_date(resignation.group(1)) if resignation else None),
        "jobTitle": chunk.get("jobTitle") or (job.group(1).strip() if job else ""),
        "workforceType": workforce_type,
        "turnoverEligible": workforce_type == "employee",
        "totals": totals,
        "remuneration": {"earnings": remuneration_earnings, "discounts": remuneration_discounts, "net": round(remuneration_earnings - remuneration_discounts, 2)},
        "maternityValue": maternity_value,
        "proLaboreValue": pro_labore_value,
        "charges": {key: round(value, 2) for key, value in charges.items()},
        "overtime": {"hours": overtime_hours, "value": overtime_value, "reflexValue": overtime_reflex_value, "reflexes": overtime_reflex_events, "events": overtime_events},
        "medicalCertificates": {"hours": medical_certificate_hours, "value": medical_certificate_value, "events": medical_certificate_events},
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
        "vacationTermination": {
            "cost": round(sum(event["value"] for event in vacation_termination_events), 2),
            "events": vacation_termination_events,
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
        if current_chunk and current_chunk.get("period") and current_chunk.get("branch"):
            if current_chunk.get("totals"):
                employees.append(extract_employee(current_chunk, current_chunk["period"], current_chunk["branch"], path.name, page_number))
            else:
                diagnostics.append({
                    "sourceFile": path.name,
                    "sourcePage": current_chunk.get("sourcePage", page_number),
                    "field": "totais do colaborador",
                    "level": "error",
                    "message": f"Totais não identificados para o contrato {current_chunk['contract']}.",
                })
        current_chunk = None

    for page_index, page in enumerate(doc, 1):
        lines = clean_lines(page.get_text())
        period, branch = page_context(lines)
        if (period and current_period and period["key"] != current_period["key"]) or (branch and current_branch and branch["code"] != current_branch["code"]):
            flush_current(page_index)
        current_period = period or current_period
        current_branch = branch or current_branch
        if not current_period or not current_branch:
            if "Total do(a)" not in page.get_text("text"):
                diagnostics.append({"sourceFile": path.name, "sourcePage": page_index, "level": "warning", "message": "Página sem competência ou estabelecimento detectado antes dos registros."})
            continue

        for row in rows_by_y(page):
            header = employee_header(row)
            if header:
                flush_current(page_index)
                current_chunk = {
                    **header,
                    "lines": [row["text"]],
                    "events": [],
                    "period": current_period,
                    "branch": current_branch,
                    "sourcePage": page_index,
                }
                continue
            if not current_chunk:
                continue

            current_chunk["lines"].append(row["text"])
            current_chunk["events"].extend(coordinate_events(row))
            resignation = re.search(r"Rescisão:\s*(\d{2}/\d{2}/\d{4})", row["text"], re.I)
            if resignation:
                current_chunk["resignationDate"] = parse_date(resignation.group(1))

            normalized_row = re.sub(r"\s+", " ", row["text"]).lower()
            if "total de vencimentos:" in normalized_row and "total de descontos:" in normalized_row:
                current_chunk["totals"] = {
                    "gross": value_in_x(row, 250, 295) or 0.0,
                    "discounts": value_in_x(row, 510, 553) or 0.0,
                    "net": value_in_x(row, 760, 825) or 0.0,
                    "salary": current_chunk.get("salary", 0.0),
                }
                flush_current(page_index)
    flush_current(doc.page_count)
    return employees


def extract_pdf_grand_total(path):
    grand_total = None
    doc = fitz.open(path)
    for page_index, page in enumerate(doc, 1):
        lines = clean_lines(page.get_text())
        for index, line in enumerate(lines):
            if "Total de Vencimentos" not in line:
                continue
            gross = exact_line_value_near(lines, index, "Total de Vencimentos:")
            if gross is None:
                continue
            grand_total = {
                "sourceFile": path.name,
                "sourcePage": page_index,
                "gross": gross,
                "discounts": exact_line_value_near(lines, index, "Total de Descontos:") or 0.0,
                "net": exact_line_value_near(lines, index, "Líquido:") or 0.0,
            }
    return grand_total


def build_dataset(paths):
    employees = []
    charge_summaries = []
    provisions = []
    provision_summaries = []
    vacation_schedule = []
    report_imports = []
    source_totals = []
    diagnostics = []
    for path in paths:
        pdf_path = Path(path)
        with fitz.open(pdf_path) as report_doc:
            preview = "\n".join(page.get_text("text") for page in report_doc[: min(2, len(report_doc))])
        detected_type = report_type(preview)
        if detected_type != "payroll":
            kind, period, records, summaries, schedule_rows, report_diagnostics = parse_special_report(pdf_path)
            provisions.extend(records)
            provision_summaries.extend(summaries)
            vacation_schedule.extend(schedule_rows)
            diagnostics.extend(report_diagnostics)
            branch_codes = sorted({item["branch"]["code"] for item in [*records, *schedule_rows]})
            report_imports.append({
                "reportType": kind,
                "period": period,
                "company": DIRECTORY["company"],
                "cnpjs": sorted({item["cnpj"] for item in [*records, *schedule_rows] if item.get("cnpj")}),
                "branchCodes": branch_codes,
                "sourceFile": pdf_path.name,
                "status": "read" if period and not any(item.get("level") == "error" for item in report_diagnostics) else "pending",
            })
            continue
        employees.extend(parse_pdf(pdf_path, diagnostics))
        charge_summaries.extend(extract_charge_summaries(pdf_path))
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
        payroll_rows = [item for item in employees if item["sourceFile"] == pdf_path.name]
        payroll_period = payroll_rows[0]["period"] if payroll_rows else None
        report_imports.append({
            "reportType": "payroll",
            "period": payroll_period,
            "company": DIRECTORY["company"],
            "cnpjs": sorted({item["branch"].get("cnpj") for item in payroll_rows if item["branch"].get("cnpj")}),
            "branchCodes": sorted({item["branch"]["code"] for item in payroll_rows}),
            "sourceFile": pdf_path.name,
            "status": "read" if total and payroll_period else "pending",
        })

    active_source_by_key = {}
    duplicate_report_keys = set()
    for report in report_imports:
        key = f"{report['reportType']}:{report['period']['key'] if report.get('period') else ''}"
        if key in active_source_by_key:
            duplicate_report_keys.add(key)
        active_source_by_key[key] = report["sourceFile"]
    if duplicate_report_keys:
        for key in sorted(duplicate_report_keys):
            diagnostics.append({
                "sourceFile": active_source_by_key[key], "sourcePage": None, "field": "competência",
                "level": "warning", "message": f"Relatório duplicado ({key}); foi considerada a última entrada do lote.",
            })
        def is_active(item, fallback_type):
            key = f"{item.get('reportType', fallback_type)}:{item.get('period', {}).get('key', '')}"
            return active_source_by_key.get(key) == item.get("sourceFile")
        employees = [item for item in employees if is_active(item, "payroll")]
        charge_summaries = [item for item in charge_summaries if is_active(item, "payroll")]
        provisions = [item for item in provisions if is_active(item, item.get("reportType", "vacation_provision"))]
        provision_summaries = [item for item in provision_summaries if is_active(item, item.get("reportType", "vacation_provision"))]
        vacation_schedule = [item for item in vacation_schedule if is_active(item, "vacation_schedule")]
        active_sources = set(active_source_by_key.values())
        source_totals = [item for item in source_totals if item["sourceFile"] in active_sources]
        report_imports = [report for report in report_imports if active_source_by_key[f"{report['reportType']}:{report['period']['key'] if report.get('period') else ''}"] == report["sourceFile"]]

    # Vacation schedule position is a report horizon, not a payroll competence.
    periods = sorted({item["period"]["key"] for item in [*employees, *provisions] if item.get("period")})
    branches = sorted(
        {json.dumps(item["branch"], ensure_ascii=False, sort_keys=True) for item in [*employees, *provisions, *vacation_schedule] if item.get("branch")}
    )
    quality = summarize_quality(employees, source_totals, diagnostics)
    for report in report_imports:
        if report["reportType"] not in {"vacation_provision", "thirteenth_provision"}:
            continue
        source = report["sourceFile"]
        source_records = [item for item in provisions if item["sourceFile"] == source]
        grand = next((item for item in provision_summaries if item["sourceFile"] == source and item["isGrandTotal"]), None)
        fields = ["currentBalance", "inss", "fgts", "total"]
        app = {field: round(sum(item[field] for item in source_records), 2) for field in fields}
        pdf = {field: grand[field] if grand else 0 for field in fields}
        difference = {field: round(app[field] - pdf[field], 2) for field in fields}
        quality["reconciliation"].append({
            "reportType": report["reportType"], "period": report["period"], "sourceFile": source, "sourcePage": grand["sourcePage"] if grand else None,
            "pdf": pdf, "app": app, "difference": difference,
            "matched": bool(grand) and all(abs(difference[field]) <= 1.00 for field in fields),
            "note": "Diferenças de até R$ 1,00 são toleradas apenas na soma de milhares de linhas individuais arredondadas; o dashboard usa o total oficial impresso.",
        })
    quality["reconciliationMatched"] = (
        bool(quality["reconciliation"] or vacation_schedule)
        and all(item["matched"] for item in quality["reconciliation"])
        and not any(item.get("level") == "error" for item in diagnostics)
    )
    quality["diagnostics"] = diagnostics
    quality["diagnosticCount"] = len(diagnostics)
    return {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "sources": [Path(path).name for path in paths],
        "periods": periods,
        "branches": [json.loads(item) for item in branches],
        "chargeSummaries": charge_summaries,
        "provisions": provisions,
        "provisionSummaries": provision_summaries,
        "vacationSchedule": vacation_schedule,
        "reportImports": report_imports,
        "employees": employees,
        "quality": quality,
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
        "unclassifiedEventCount": len(unclassified),
        "unclassifiedOccurrenceCount": sum(item["count"] for item in unclassified.values()),
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
