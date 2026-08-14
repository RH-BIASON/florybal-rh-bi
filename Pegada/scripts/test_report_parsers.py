import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from report_parsers import period_from_report, report_type


class ReportRecognitionTests(unittest.TestCase):
    def test_report_types_are_identified_from_content(self):
        self.assertEqual(report_type("Provisao Ferias c/ Encargos - Analitico"), "vacation_provision")
        self.assertEqual(report_type("Provisao de 13 Salario c/ Encargos - Analitico"), "thirteenth_provision")
        self.assertEqual(report_type("Controle e Programacao das Ferias"), "vacation_schedule")
        self.assertEqual(report_type("Folha de Pagamento\nFolhas: 01/07/2026 a 31/07/2026"), "payroll")

    def test_provision_competence_comes_from_report_content(self):
        text = "Folhas de 01/07/2026 a 31/07/2026"
        self.assertEqual(period_from_report(text, "vacation_provision")["key"], "2026-07")
        self.assertEqual(period_from_report(text, "thirteenth_provision")["key"], "2026-07")

    def test_vacation_schedule_uses_its_position_month(self):
        period = period_from_report("Controle e Programacao das Ferias\nPosicao em 31/12/2026", "vacation_schedule")
        self.assertEqual(period["key"], "2026-12")
        self.assertEqual(period["positionDate"], "2026-12-31")


if __name__ == "__main__":
    unittest.main()
