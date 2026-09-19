Feature: Fairness is a hard gate

  Scenario: protected_attribute_rejected
    Given an applicant record that includes a protected attribute such as zip_code
    Then the input schema rejects it

  Scenario: proxy_flagged_not_used
    Given a report that lists a circumstance signal in circumstance_signals_excluded
    Then that signal does not appear as evidence for any estimate

  Scenario: donor_estimate_is_trajectory_not_wealth
    Given two applicants with identical ambition and reciprocity signals
    And they differ only in synthetic family wealth
    When both are scored
    Then their donor estimates differ by no more than the noise tolerance
    And a rich applicant with no reciprocity signals scores below a modest applicant with strong ones

  Scenario: fairness_auditor_can_veto
    Given a report whose evidence cites a protected proxy
    When the fairness auditor reviews it
    Then the verdict is veto and the report is withheld

  Scenario: textual_proxy_does_not_move_estimates
    Given two applicants with identical person signals
    And one statement additionally mentions family wealth, geography and employer sponsorship
    When both are scored
    Then either the proxied report is withheld by the auditor
    Or the donor estimates differ by no more than the noise tolerance and the proxy is listed under circumstance_signals_excluded
