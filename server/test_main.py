import unittest

from server.main import DEMO_RULES, evaluate_request


def entities():
    return [
        {
            "name": rule["name"],
            "body": rule,
            "updated_at": "2026-08-25T00:00:00.000Z",
        }
        for rule in DEMO_RULES
    ]


class DecisionTests(unittest.TestCase):
    def test_prior_incident_and_leverage_block_request(self):
        result = evaluate_request("Hire Atlas Grid with a $5,000 budget and allow 5x leverage.", entities())
        self.assertEqual(result["verdict"], "BLOCKED")
        self.assertEqual(result["allowed_budget"], 0)
        self.assertEqual(len(result["matches"]), 3)

    def test_budget_memory_reduces_authority(self):
        result = evaluate_request("Hire a new yield agent with a $4,000 budget and no leverage.", entities())
        self.assertEqual(result["verdict"], "BOUND")
        self.assertEqual(result["allowed_budget"], 2000)

    def test_safe_request_clears(self):
        result = evaluate_request("Hire a new yield agent with a $1,000 budget and no leverage.", entities())
        self.assertEqual(result["verdict"], "CLEARED")
        self.assertEqual(result["allowed_budget"], 1000)


if __name__ == "__main__":
    unittest.main()
