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
