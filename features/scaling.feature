Feature: Scaling path via domain packs

  Scenario: domain_pack_swap
    Given the startup-recruiting domain pack
    When it is loaded
    Then the outcomes are hire, retain_2y, refer and advocate
    And no core module changes

  Scenario: recruiter_multiplier_uses_real_referral_history
    Given an applicant with 3 referrals already made
    When the analyst produces a report
    Then the recruiter multiplier reasoning cites institution_interaction.referrals_made

  Scenario: domain_pack_drives_report_schema
    Given the startup-recruiting domain pack
    When the report schema is built from it
    Then the report's outcomes are exactly hire, retain_2y, refer and advocate
    And there is no trajectory sub-structure because the pack defines no trajectory outcome
    And a university-shaped report is rejected by the startup schema
