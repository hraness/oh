/**
 * Additive bridge predicates for common cross-domain query paths.
 *
 * These relations intentionally keep open ranges and do not infer identity,
 * ownership, truth, or temporal validity. They make explicit links that are
 * otherwise easy to lose when projecting a source record into a domain pack.
 */
export type BridgeRelationDefinition = readonly [
  code: string,
  label: string,
  description: string,
];

export const bridgeRelationDefinitions = [
  ["offer-for-product", "Offer for product", "The offer is for the identified product; this does not establish availability, authenticity, or a current price."],
  ["offer-has-price", "Offer has price", "The offer states the identified price record; currency, interval, tax, and effective dates remain separate context."],
  ["assay-uses-method", "Assay uses method", "The assay uses the identified method; this does not establish that the method is valid, suitable, or reproducible."],
  ["assay-produces-result", "Assay produces result", "The assay reports the identified result; this does not establish efficacy, significance, or safety."],
  ["placement-in-article", "Placement in article", "The placement occurs in the identified article or edition; position, prominence, and publication state remain separate."],
  ["series-has-member-event", "Series has member event", "The event series includes the identified event; membership does not establish chronology or completeness."],
  ["track-has-recording", "Track has recording", "The track is realized by the identified recording; this does not establish release, performer, or rights ownership."],
  ["listing-at-venue", "Listing at venue", "The listing is associated with the identified venue or place; this does not establish current operation or access."],
  ["snapshot-of-simulation", "Snapshot of simulation", "The snapshot was produced by or belongs to the identified simulation; tick, state, and provenance remain separate."],
  ["trajectory-has-attempt", "Trajectory has attempt", "The trajectory contains the identified task attempt; this does not establish success, causality, or completeness."],
  ["task-pursues-goal", "Task pursues goal", "The task pursues the identified goal; this does not establish that the goal was achieved or authorized."],
  ["profile-for-account", "Profile for account", "The profile document or projection is associated with the identified account; association does not prove account control or person identity."],
  ["role-assignment-at-organization", "Role assignment at organization", "The role assignment concerns the identified organization; this does not establish employment, authority, or current status."],
  ["lexeme-in-language-system", "Lexeme in language system", "The lexeme is associated with the identified language system; this does not normalize spelling, script, dialect, or sense."],
] as const satisfies readonly BridgeRelationDefinition[];
