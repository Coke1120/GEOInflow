// Rule identity survives cleanup so delayed logs retain their original policy association.
export const crawlerOwnedRuleIds = `SELECT p.remote_rule_id AS rule_id FROM liekan_crawler_policy p
  WHERE p.website_id=l.website_id AND p.remote_rule_id IS NOT NULL
  UNION SELECT d.result->>'ruleId' FROM liekan_crawler_deployment d
  WHERE d.website_id=l.website_id AND d.result->>'ruleId' IS NOT NULL`;
export const crawlerOwnedBlock = `e.security_action='block' AND e.terminating_rule_id IN (${crawlerOwnedRuleIds})`;
export const crawlerOwnedMatch = `EXISTS(SELECT 1 FROM (${crawlerOwnedRuleIds}) owned WHERE e.matched_rule_ids ? owned.rule_id)`;

// Five minutes around a deployment are excluded from version-dependent expectations.
// Unknown and conflicting operations end the preceding certainty interval as well.
export const crawlerIntentionalBlock = `${crawlerOwnedBlock} AND EXISTS(
  SELECT 1 FROM liekan_crawler_deployment d WHERE d.website_id=l.website_id
    AND d.state='confirmed' AND d.operation IN('deploy','rollback') AND coalesce(d.target->>'mode','apply')!='adopt'
    AND d.result->>'ruleId'=e.terminating_rule_id
    AND d.target->'body'->>'action'='block' AND d.target->'body'->>'expectedAccess'='block'
    AND d.target->'rule'->>'enabled'='true'
    AND d.completed_at+interval '5 minutes'<=l.created_at
    AND NOT EXISTS(SELECT 1 FROM liekan_crawler_deployment later
      WHERE later.policy_id=d.policy_id AND later.created_at>d.created_at
        AND coalesce(later.target->>'mode','apply')!='adopt'
        AND later.state IN('running','confirmed','unknown','conflict','cleanup')
        AND later.created_at-interval '5 minutes'<=l.created_at))`;
