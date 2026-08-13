import sys
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from parse_payroll import build_dataset
from report_parsers import period_from_report


FILES = [
    Path(r"C:\Users\lucasg\Downloads\provisao ferias 072026.pdf"),
    Path(r"C:\Users\lucasg\Downloads\Provisao decimo 072026.pdf"),
    Path(r"C:\Users\lucasg\Downloads\ferias geral 072026 Florybal (1).pdf"),
]


class ReportCompetenceRuleTests(unittest.TestCase):
    def test_vacation_schedule_uses_month_before_position_date(self):
        period = period_from_report("Controle e Programação das Férias\nPosição em 07/08/2026", "vacation_schedule")
        self.assertEqual(period["key"], "2026-07")
        self.assertEqual(period["positionDate"], "2026-08-07")
        self.assertEqual(period["end"], "2026-08-07")

    def test_vacation_schedule_handles_year_boundary(self):
        period = period_from_report("Posição em 05/01/2027", "vacation_schedule")
        self.assertEqual(period["key"], "2026-12")


@unittest.skipUnless(all(path.exists() for path in FILES), "PDFs de validação não disponíveis nesta máquina")
class SpecialReportParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = build_dataset(FILES)

    def test_report_types_and_content_periods(self):
        reports = {(item["reportType"], item["period"]["key"]) for item in self.dataset["reportImports"]}
        self.assertEqual(reports, {
            ("vacation_provision", "2026-07"),
            ("thirteenth_provision", "2026-07"),
            ("vacation_schedule", "2026-07"),
        })
        self.assertTrue(all(item["status"] == "read" for item in self.dataset["reportImports"]))
        schedule_import = next(item for item in self.dataset["reportImports"] if item["reportType"] == "vacation_schedule")
        self.assertEqual(schedule_import["period"]["positionDate"], "2026-08-07")

    def test_official_provision_totals(self):
        grand = {item["reportType"]: item for item in self.dataset["provisionSummaries"] if item["isGrandTotal"]}
        vacation = grand["vacation_provision"]
        self.assertEqual((vacation["currentBalance"], vacation["inss"], vacation["fgts"], vacation["total"]), (1306227.82, 364250.01, 103719.83, 1774197.66))
        thirteenth = grand["thirteenth_provision"]
        self.assertEqual((thirteenth["currentBalance"], thirteenth["inss"], thirteenth["fgts"], thirteenth["total"]), (559178.68, 155824.57, 43825.11, 758828.36))
        self.assertTrue(self.dataset["quality"]["reconciliationMatched"])

    def test_establishments_and_cnpjs_are_isolated(self):
        self.assertEqual(len(self.dataset["branches"]), 21)
        self.assertTrue(all(item["cnpj"] and item["branch"]["code"] for item in [*self.dataset["provisions"], *self.dataset["vacationSchedule"]]))
        self.assertEqual(len({(item["branch"]["code"], item["cnpj"]) for item in self.dataset["vacationSchedule"]}), 21)

    def test_schedule_periods_and_oldest_priority(self):
        rows = self.dataset["vacationSchedule"]
        people = Counter((item["branch"]["code"], item["contract"]) for item in rows)
        self.assertEqual(len(rows), 495)
        self.assertEqual(len(people), 369)
        self.assertGreater(sum(count > 1 for count in people.values()), 100)
        key = next(key for key, count in people.items() if count > 1)
        periods = sorted(item["acquisitionStart"] for item in rows if (item["branch"]["code"], item["contract"]) == key)
        self.assertLess(periods[0], periods[-1])


if __name__ == "__main__":
    unittest.main()
