import unittest
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from parse_payroll import build_dataset, is_classified_event, loan_kind, medical_certificate_kind, overtime_reflex_kind, vacation_kind, vacation_termination_kind

PDFS = [
    ROOT / "FOPAG Florybal 122025.pdf",
    ROOT / "FOPAG Florybal 012026.pdf",
    ROOT / "FOPAG Florybal 022026.pdf",
    ROOT / "FOPAG Florybal 032026.pdf",
    ROOT / "FOPAG Florybal 042026.pdf",
]
MAY_PDF = ROOT / "FOPAG Florybal 052026.pdf"


class PayrollParserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dataset = build_dataset(PDFS)

    def test_core_coverage_and_reconciliation(self):
        dataset = self.dataset
        self.assertEqual(dataset["quality"]["employeeRecords"], 1871)
        self.assertEqual(len(dataset["branches"]), 20)
        self.assertEqual(dataset["periods"], ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04"])
        self.assertTrue(dataset["quality"]["reconciliationMatched"])
        self.assertEqual(dataset["quality"]["diagnosticCount"], 0)

    def test_event_classification_baseline(self):
        quality = self.dataset["quality"]
        self.assertEqual(quality["unclassifiedEventCount"], 0, quality["unclassifiedEvents"][:5])

    def test_critical_categories_are_present(self):
        employees = self.dataset["employees"]
        self.assertGreater(sum(item["overtime"]["hours"] for item in employees), 5000)
        self.assertGreater(sum(item["absence"]["hours"] for item in employees), 7000)
        self.assertGreater(sum(item["variables"]["value"] for item in employees), 1_000_000)
        self.assertGreater(sum(1 for item in employees if item["loans"]["value"] > 0), 200)
        self.assertGreater(sum(1 for item in employees if item["vacation"]["cost"] > 0), 150)

    def test_estorno_econsignado_is_not_loan(self):
        event = {
            "code": "49992",
            "description": "Estorno Prov eConsign s/Férias",
            "quantity": None,
            "value": 518,
        }
        self.assertIsNone(loan_kind(event))
        self.assertTrue(is_classified_event(event))

    def test_vacation_and_termination_vacation_are_separated(self):
        regular = {"code": "00061", "description": "Férias", "quantity": None, "value": 100}
        termination = {"code": "00070", "description": "Férias Proporcionais", "quantity": None, "value": 100}
        self.assertEqual(vacation_kind(regular), "Ferias")
        self.assertIsNone(overtime_reflex_kind(regular))
        self.assertIsNone(vacation_termination_kind(regular))
        self.assertEqual(vacation_termination_kind(termination), "Ferias rescisorias")
        self.assertIsNone(overtime_reflex_kind(termination))
        self.assertIsNone(vacation_kind(termination))

    def test_no_branch_or_period_loss(self):
        employees = self.dataset["employees"]
        self.assertTrue(all(item["branch"]["code"] for item in employees))
        self.assertTrue(all(item["period"]["key"] for item in employees))
        self.assertIn("000", {item["branch"]["code"] for item in employees})
        self.assertIn("019", {item["branch"]["code"] for item in employees})

    def test_reflex_and_medical_certificate_use_exact_codes(self):
        reflex = {"code": "00030", "description": "Reflexo HE", "quantity": None, "value": 100}
        old_reflex = {"code": "00058", "description": "Media de horas extras", "quantity": None, "value": 100}
        certificate = {"code": "00007", "description": "Atestado", "quantity": 8, "value": 100}
        self.assertEqual(overtime_reflex_kind(reflex), "Reflexo HE")
        self.assertIsNone(overtime_reflex_kind(old_reflex))
        self.assertEqual(medical_certificate_kind(certificate), "Atestado")
        self.assertTrue(is_classified_event(old_reflex))

    def test_fgts_and_inss_company_use_exact_codes(self):
        employees = self.dataset["employees"]
        self.assertAlmostEqual(sum(item["charges"]["fgts"] for item in employees), 1_140_195.00, places=2)
        self.assertAlmostEqual(sum(item["charges"]["inss_company"] for item in employees), 158_086.22, places=2)

    def test_official_charge_summaries_are_extracted(self):
        grand_totals = [item for item in self.dataset["chargeSummaries"] if item["isGrandTotal"]]
        self.assertEqual(len(grand_totals), 5)
        self.assertAlmostEqual(sum(item["charges"]["fgts"] for item in grand_totals), 518_030.88, places=2)
        self.assertAlmostEqual(sum(item["charges"]["inss_company"] for item in grand_totals), 1_180_688.69, places=2)

    def test_may_charge_summary_uses_pdf_grand_total(self):
        dataset = build_dataset([MAY_PDF])
        grand_total = next(item for item in dataset["chargeSummaries"] if item["isGrandTotal"])
        self.assertEqual(grand_total["period"]["key"], "2026-05")
        self.assertAlmostEqual(grand_total["charges"]["fgts"], 126_049.31, places=2)
        self.assertAlmostEqual(grand_total["charges"]["inss_company"], 266_479.21, places=2)


if __name__ == "__main__":
    unittest.main()
