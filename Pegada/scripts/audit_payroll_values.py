import json
import sys
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "data" / "payroll.json"
TOLERANCE = 0.02
REMUNERATION_EARNINGS = {"00001", "00002", "00003", "00005", "00007", "00010", "00014", "00020", "00021", "00022", "00025", "00026", "00030", "00031", "00061", "00062", "00064", "00065", "00068", "00081", "00083", "00092", "00093", "00772", "00813", "00819", "00840", "00841", "00844"}
REMUNERATION_DISCOUNTS = {"00201", "00202", "00203", "00247", "00254", "00283"}


def money(value):
    return f"R$ {value:,.2f}".replace(",", "_").replace(".", ",").replace("_", ".")


def main():
    dataset = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    issues = []
    unclassified = dataset.get("quality", {}).get("unclassifiedEvents", [])
    if unclassified:
        issues.append(f"Existem {len(unclassified)} rubricas nao classificadas na base oficial.")
    employees = dataset.get("employees", [])
    branches = {item["code"]: item for item in dataset.get("branches", [])}

    for employee in employees:
        totals = employee.get("totals", {})
        difference = round((totals.get("gross", 0) - totals.get("discounts", 0)) - totals.get("net", 0), 2)
        if abs(difference) > TOLERANCE:
            issues.append(f"{employee['sourceFile']} p.{employee['sourcePage']} contrato {employee['contract']}: bruto - descontos difere do liquido em {money(difference)}")
        branch = branches.get(employee.get("branch", {}).get("code"))
        if not branch or branch.get("cnpj") != employee.get("cnpj"):
            issues.append(f"Contrato {employee['contract']}: filial/CNPJ nao corresponde ao cadastro")
        events = employee.get("events", [])
        expected_earnings = round(sum(event.get("value", 0) for event in events if event.get("side") == "earnings" and event.get("code") in REMUNERATION_EARNINGS), 2)
        expected_discounts = round(sum(event.get("value", 0) for event in events if event.get("side") == "discounts" and event.get("code") in REMUNERATION_DISCOUNTS), 2)
        remuneration = employee.get("remuneration", {})
        if abs(remuneration.get("earnings", 0) - expected_earnings) > TOLERANCE or abs(remuneration.get("discounts", 0) - expected_discounts) > TOLERANCE:
            issues.append(f"Contrato {employee['contract']}: remuneracao inclui ou omite rubrica fora da regra")

    reconciliation = dataset.get("quality", {}).get("reconciliation", [])
    if not reconciliation or not all(item.get("matched") for item in reconciliation):
        issues.append("Existe relatorio sem reconciliacao aprovada")

    provision_summaries = dataset.get("provisionSummaries", [])
    provision_counts = Counter(item.get("reportType") for item in provision_summaries if not item.get("isGrandTotal"))
    for report_type in ("vacation_provision", "thirteenth_provision"):
        if provision_counts[report_type] != len(branches):
            issues.append(f"{report_type}: {provision_counts[report_type]} de {len(branches)} subtotais por estabelecimento")

    grand = next(item for item in dataset.get("chargeSummaries", []) if item.get("isGrandTotal"))
    output = {
        "status": "APROVADO" if not issues else "REVISAR",
        "employeeRecords": len(employees),
        "establishments": len(branches),
        "payroll": {
            "gross": grand["payroll"]["gross"],
            "discounts": grand["payroll"]["discounts"],
            "net": grand["payroll"]["net"],
            "remuneration": grand["payroll"]["remunerationNet"],
        },
        "provisionBranchSummaries": dict(provision_counts),
        "vacationSchedulePeriods": len(dataset.get("vacationSchedule", [])),
        "issues": issues[:50],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    if issues:
        sys.exit(1)


if __name__ == "__main__":
    main()
