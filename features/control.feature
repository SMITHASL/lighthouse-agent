Feature: Humans stay in control

  Scenario: human_approval_required_for_action
    Given the pipeline reaches a recommended action
    When the agent calls pipeline.propose_action
    Then the session pauses with tool.approval_required
    And nothing is written to the pipeline until a human allows it

  Scenario: budget_exhausted_degrades_gracefully
    Given a per-report budget that is already spent
    When a report is requested
    Then the runner returns a partial report with a data_gap risk flag
    And no exception escapes

  Scenario: nightly_rescoring_updates_calibration
    Given predictions with recorded ground truth
    When rescoring runs
    Then calibration metrics are recomputed and stored with a timestamp

  Scenario: independent_auditor_on_a_different_vendor
    Given the analyst runs on one model vendor
    When LIGHTHOUSE_AUDITOR_MODEL names a model from another vendor
    Then the fairness auditor runs on that vendor through the same runtime
    And the transcript, tool loop and approval gate behave identically
    And a refusal from the vendor is surfaced as an error rather than an empty verdict
