import unittest
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from parse_payroll import build_dataset, is_classified_event, loan_kind

PDFS = [
    ROOT / "FOPAG Florybal 122025.pdf",
    ROOT / "FOPAG Florybal 012026.pdf",
    ROOT / "FOPAG Florybal 022026.pdf",
    ROOT / "FOPAG Florybal 032026.pdf",
    ROOT / "FOPAG Florybal 042026.pdf",
]


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

    def test_no_branch_or_period_loss(self):
        employees = self.dataset["employees"]
        self.assertTrue(all(item["branch"]["code"] for item in employees))
        self.assertTrue(all(item["period"]["key"] for item in employees))
        self.assertIn("000", {item["branch"]["code"] for item in employees})
        self.assertIn("019", {item["branch"]["code"] for item in employees})


if __name__ == "__main__":
    unittest.main()
