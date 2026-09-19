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
