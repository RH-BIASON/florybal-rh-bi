import sys
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from parse_payroll import build_dataset, is_classified_event, loan_kind


FILES = [
    Path(r"F:\Pastas Pessoais\Lucas G\RESUMO GERAL ANALITICO 072026.pdf"),
    Path(r"C:\Users\lucasg\Desktop\prov Ferias.pdf"),
    Path(r"C:\Users\lucasg\Desktop\prov 13 salario.pdf"),
    Path(r"C:\Users\lucasg\Desktop\Saldo ferias geral.pdf"),
]


@unittest.skipUnless(all(path.exists() for path in FILES), "PDFs oficiais da Pegada nao disponiveis")
class PegadaParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = build_dataset(FILES)

    def test_payroll_totals_and_population_match_official_summary(self):
        dataset = self.dataset
        grand = next(item for item in dataset["chargeSummaries"] if item["isGrandTotal"])
        self.assertEqual(dataset["quality"]["employeeRecords"], 6034)
        self.assertEqual(len(dataset["branches"]), 23)
        self.assertEqual(len(dataset["chargeSummaries"]), 24)
        self.assertEqual(grand["counts"]["contracts"], 6017)
        self.assertEqual(grand["counts"]["active"], 5682)
        self.assertEqual(grand["counts"]["onLeave"], 262)
        self.assertEqual(grand["counts"]["admissions"], 209)
        self.assertEqual(grand["counts"]["resignations"], 73)
        self.assertEqual(grand["payroll"]["gross"], 17037147.74)
        self.assertEqual(grand["payroll"]["discounts"], 6894595.14)
        self.assertEqual(grand["payroll"]["net"], 10142552.60)
        self.assertTrue(dataset["quality"]["reconciliationMatched"])
        self.assertEqual(dataset["quality"]["diagnosticCount"], 0)
        self.assertEqual(dataset["quality"]["unclassifiedEventCount"], 0)
        self.assertEqual(dataset["periods"], ["2026-07"])

    def test_remuneration_excludes_bases(self):
        grand = next(item for item in self.dataset["chargeSummaries"] if item["isGrandTotal"])
        payroll = grand["payroll"]
        self.assertEqual(payroll["remunerationEarnings"], 12395464.79)
        self.assertEqual(payroll["remunerationDiscounts"], 347933.33)
        self.assertEqual(payroll["remunerationNet"], 12047531.46)
        self.assertEqual(payroll["maternity"], 104023.02)
        self.assertEqual(payroll["proLabore"], 45000.00)
        for employee in self.dataset["employees"]:
            expected_inss = sum(
                event["value"]
                for event in employee["events"]
                if event["side"] == "discounts" and event["code"] in {"00381", "00382", "00383", "00384"}
            )
            expected_irrf = sum(
                event["value"]
                for event in employee["events"]
                if event["side"] == "discounts" and event["code"] in {"00391", "00392"}
            )
            self.assertAlmostEqual(employee["charges"]["inss_employee"], expected_inss, places=2)
            self.assertAlmostEqual(employee["charges"]["irrf"], expected_irrf, places=2)

    def test_official_provision_totals_and_branch_isolation(self):
        summaries = self.dataset["provisionSummaries"]
        self.assertEqual(len(summaries), 48)
        grand = {item["reportType"]: item for item in summaries if item["isGrandTotal"]}
        vacation = grand["vacation_provision"]
        self.assertEqual(
            (vacation["currentBalance"], vacation["inss"], vacation["fgts"], vacation["total"]),
            (5967727.61, 1079114.85, 462989.04, 7509831.50),
        )
        thirteenth = grand["thirteenth_provision"]
        self.assertEqual(
            (thirteenth["currentBalance"], thirteenth["inss"], thirteenth["fgts"], thirteenth["total"]),
            (6638058.54, 1202334.77, 476615.81, 8317009.12),
        )
        for report_type in ("vacation_provision", "thirteenth_provision"):
            branches = {
                item["branch"]["code"]
                for item in summaries
                if item["reportType"] == report_type and not item["isGrandTotal"]
            }
            self.assertEqual(len(branches), 23)

    def test_vacation_schedule_keeps_all_periods(self):
        rows = self.dataset["vacationSchedule"]
        people = Counter((item["branch"]["code"], item["contract"]) for item in rows)
        self.assertEqual(len(rows), 5903)
        self.assertEqual(len(people), 5478)
        self.assertGreater(sum(count > 1 for count in people.values()), 300)
        self.assertEqual({item["period"]["key"] for item in rows}, {"2026-12"})
        self.assertTrue(all(item["cnpj"] and item["branch"]["code"] for item in rows))

    def test_exact_loan_codes_only(self):
        valid = {"code": "61501", "description": "Emprestimo eConsignado Contr.1", "value": 100}
        provision = {"code": "61114", "description": "Provisao eConsignado Ferias", "value": 100}
        reversal = {"code": "49992", "description": "Estorno Prov eConsign s/Ferias", "value": 100}
        self.assertEqual(loan_kind(valid), "Consignado")
        self.assertIsNone(loan_kind(provision))
        self.assertIsNone(loan_kind(reversal))
        self.assertTrue(is_classified_event(provision))
        self.assertTrue(is_classified_event(reversal))


if __name__ == "__main__":
    unittest.main()
