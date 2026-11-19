Feature: Shop

  Scenario: Browse the catalog
    Given I open the shop
    When I load the catalog
    Then the catalog is shown
